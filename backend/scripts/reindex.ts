import { prisma } from '../src/config/database';
import { esClient, ES_INDICES } from '../src/config/elasticsearch';
import { EmailDocument } from '../src/services/search.service';

/**
 * Rebuilds the entire Elasticsearch index from PostgreSQL.
 * Used for offline recovery and consistency fixes.
 */
async function main() {
  console.log('🔄 Starting Elasticsearch reindex from PostgreSQL...');

  const total = await prisma.email.count();
  console.log(`Total emails in database: ${total}`);

  if (total === 0) {
    console.log('No emails to reindex.');
    return;
  }

  const batchSize = 1000;
  let processed = 0;

  for (let skip = 0; skip < total; skip += batchSize) {
    const emails = await prisma.email.findMany({
      skip,
      take: batchSize,
      include: {
        job: {
          select: { userId: true, senderEmail: true, subject: true, body: true },
        },
      },
    });

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
      console.error('❌ Bulk indexing encountered errors', {
        errors: response.items.filter((i) => i.index?.error),
      });
    }

    processed += emails.length;
    console.log(`✅ Processed ${processed}/${total} emails...`);
  }

  console.log('🎉 Reindex complete!');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Reindex script failed:', err);
  process.exit(1);
});
