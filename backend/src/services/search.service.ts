import { esClient, ES_INDICES } from '../config/elasticsearch';
import { logger } from '../middleware/errorHandler';
import { prisma } from '../config/database';

// ──────────────────────────────────────────────────────────────────────────────
// Elasticsearch Search Service
// ──────────────────────────────────────────────────────────────────────────────

export type EmailDocument = {
  jobId: string;
  emailId: string;
  recipient: string;
  sender: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date | string;
  sentAt?: Date | string | null;
  createdAt: Date | string;
  userId: string;
  idempotencyKey: string;
};

/**
 * Fetch an email from PostgreSQL and sync it to Elasticsearch.
 * This is the primary function used by worker transitions.
 * It is safe to fire-and-forget (errors are logged, not thrown).
 */
export async function syncEmailToElasticsearch(emailId: string): Promise<void> {
  try {
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      include: {
        job: {
          select: { userId: true, senderEmail: true, subject: true, body: true },
        },
      },
    });

    if (!email) {
      logger.warn({ emailId }, 'Could not find email in DB for ES sync');
      return;
    }

    const doc: EmailDocument = {
      jobId: email.jobId,
      emailId: email.id,
      recipient: email.recipient,
      sender: email.job.senderEmail,
      subject: email.job.subject,
      body: email.job.body,
      status: email.status,
      scheduledAt: email.scheduledAt.toISOString(),
      sentAt: email.sentAt ? email.sentAt.toISOString() : null,
      createdAt: email.createdAt.toISOString(),
      userId: email.job.userId,
      idempotencyKey: email.idempotencyKey,
    };

    await esClient.index({
      index: ES_INDICES.EMAILS,
      id: doc.emailId,
      document: doc,
    });

    logger.debug({ emailId: doc.emailId }, 'Email indexed in Elasticsearch');
  } catch (err) {
    logger.error({ err, emailId }, 'Failed to index email in Elasticsearch (eventual consistency trade-off)');
  }
}

/**
 * Fetch multiple emails from PostgreSQL and bulk-index them into Elasticsearch.
 * This is used for new job creations.
 * It is safe to fire-and-forget.
 */
export async function bulkSyncEmails(emailIds: string[]): Promise<void> {
  if (emailIds.length === 0) return;

  try {
    const emails = await prisma.email.findMany({
      where: { id: { in: emailIds } },
      include: {
        job: {
          select: { userId: true, senderEmail: true, subject: true, body: true },
        },
      },
    });

    if (emails.length === 0) return;

    const operations = emails.flatMap((email) => {
      const doc: EmailDocument = {
        jobId: email.jobId,
        emailId: email.id,
        recipient: email.recipient,
        sender: email.job.senderEmail,
        subject: email.job.subject,
        body: email.job.body,
        status: email.status,
        scheduledAt: email.scheduledAt.toISOString(),
        sentAt: email.sentAt ? email.sentAt.toISOString() : null,
        createdAt: email.createdAt.toISOString(),
        userId: email.job.userId,
        idempotencyKey: email.idempotencyKey,
      };

      return [
        { index: { _index: ES_INDICES.EMAILS, _id: doc.emailId } },
        doc,
      ];
    });

    const response = await esClient.bulk({ refresh: true, operations });

    if (response.errors) {
      logger.error({
        errors: response.items.filter((i) => i.index?.error),
      }, 'Bulk indexing encountered errors');
    } else {
      logger.info({ count: emails.length }, 'Bulk indexed emails to Elasticsearch');
    }
  } catch (err) {
    logger.error({ err, count: emailIds.length }, 'Failed to bulk index emails in Elasticsearch');
  }
}

/**
 * Old indexEmail method (kept for backward compatibility with tests/existing calls temporarily).
 */
export async function indexEmail(doc: EmailDocument): Promise<void> {
  try {
    await esClient.index({
      index: ES_INDICES.EMAILS,
      id: doc.emailId,
      document: {
        ...doc,
        scheduledAt: new Date(doc.scheduledAt).toISOString(),
        sentAt: doc.sentAt ? new Date(doc.sentAt).toISOString() : null,
        createdAt: new Date(doc.createdAt).toISOString(),
      },
    });
  } catch (err) {
    logger.error({ err, emailId: doc.emailId }, 'Failed to index email');
  }
}

export type SearchEmailsParams = {
  query: string;
  userId: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export type SearchEmailsResult = {
  hits: EmailDocument[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Full-text search emails in Elasticsearch.
 * User-isolated by mandatory userId parameter.
 */
export async function searchEmails(
  params: SearchEmailsParams,
): Promise<SearchEmailsResult> {
  const { query, userId, status, page = 1, pageSize = 20 } = params;
  const from = (page - 1) * pageSize;

  const mustClauses: any[] = [{ term: { userId } }];

  if (query && query.trim() !== '') {
    mustClauses.push({
      multi_match: {
        query,
        fields: ['subject^3', 'body', 'recipient^2', 'sender'],
        type: 'best_fields',
        fuzziness: 'AUTO',
      },
    });
  }

  if (status) {
    mustClauses.push({ term: { status } });
  }

  const response = await esClient.search<EmailDocument>({
    index: ES_INDICES.EMAILS,
    from,
    size: pageSize,
    query: {
      bool: {
        must: mustClauses,
      },
    },
    sort: [{ scheduledAt: { order: 'desc' } }],
  });

  const hits = response.hits.hits
    .map((hit) => hit._source)
    .filter((s): s is EmailDocument => s !== undefined);

  return {
    hits,
    total: typeof response.hits.total === 'number'
      ? response.hits.total
      : (response.hits.total?.value ?? 0),
    page,
    pageSize,
  };
}
