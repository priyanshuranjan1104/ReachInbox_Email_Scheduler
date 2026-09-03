import crypto from 'crypto';
import { prisma } from '../config/database';
import { enqueueEmail, EmailJobPayload } from '../queues/email.queue';
import { logger } from '../middleware/errorHandler';
import { bulkSyncEmails, syncEmailToElasticsearch } from './search.service';
import { CreateJobInput, normaliseRecipient, NormalisedRecipient } from '../schemas/job.schema';
import { EmailStatus, JobStatus, Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

// ──────────────────────────────────────────────────────────────────────────────
// Job Service — core business logic for email job scheduling
// ──────────────────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

export type CreateJobResult = {
  jobId: string;
  totalRecipients: number;
  scheduledAt: Date;
  estimatedCompletionAt: Date;
};

export type JobWithProgress = {
  id: string;
  userId: string;
  subject: string;
  senderEmail: string;
  senderName: string | null;
  scheduledAt: Date;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  rescheduledCount: number;
  status: JobStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive a stable, collision-resistant idempotency key from a job ID and recipient.
 * SHA-256(jobId + '\x00' + recipientEmail) — guaranteed unique per job-recipient pair.
 */
export function deriveIdempotencyKey(jobId: string, recipientEmail: string): string {
  return crypto
    .createHash('sha256')
    .update(`${jobId}\x00${recipientEmail}`)
    .digest('hex');
}

/**
 * Estimate when all emails in a job will have been sent.
 */
function estimateCompletion(
  scheduledAt: Date,
  totalRecipients: number,
  delayBetweenEmailsMs: number,
): Date {
  const totalMs = (totalRecipients - 1) * delayBetweenEmailsMs;
  return new Date(scheduledAt.getTime() + totalMs);
}

// ── Create Job ─────────────────────────────────────────────────────────────────

/**
 * Create an EmailJob + individual Email records + enqueue BullMQ delayed jobs.
 *
 * Transaction guarantee:
 *   - All DB writes happen before any BullMQ enqueue.
 *   - If enqueue fails, DB records are preserved (can be re-enqueued on demand).
 *   - Idempotency keys are DB-unique, so duplicate submissions are rejected by
 *     the UNIQUE constraint before hitting the queue.
 */
export async function createEmailJob(
  userId: string,
  input: CreateJobInput,
): Promise<CreateJobResult> {
  const recipients: NormalisedRecipient[] = input.recipients.map(normaliseRecipient);

  // ── De-duplicate recipients (same email may appear twice in CSV) ──────────
  const uniqueByEmail = new Map<string, NormalisedRecipient>();
  for (const r of recipients) {
    uniqueByEmail.set(r.email.toLowerCase(), r);
  }
  const dedupedRecipients = Array.from(uniqueByEmail.values());

  if (dedupedRecipients.length === 0) {
    throw AppError.badRequest('No valid unique recipients after de-duplication');
  }

  const totalRecipients = dedupedRecipients.length;
  const scheduledAt = input.scheduledAt;

  logger.info(
    { userId, totalRecipients, scheduledAt },
    'Creating email job',
  );

  // ── Step 1: Persist EmailJob in a transaction ─────────────────────────────
  let emailJobId: string;

  const result = await prisma.$transaction(async (tx) => {
    // Create the parent job record
    const emailJob = await tx.emailJob.create({
      data: {
        userId,
        subject: input.subject,
        body: input.body,
        senderEmail: input.senderEmail,
        senderName: input.senderName ?? null,
        scheduledAt,
        delayBetweenEmailsMs: input.delayBetweenEmailsMs,
        hourlyLimit: input.hourlyLimit,
        totalRecipients,
        status: 'PENDING',
      },
    });

    emailJobId = emailJob.id;

    // Create individual Email records with pre-computed idempotency keys.
    // Each email is SCHEDULED and will be transitioned by the worker.
    const emailData: Prisma.EmailCreateManyInput[] = dedupedRecipients.map(
      (r, index) => ({
        jobId: emailJob.id,
        recipient: r.email,
        subject: input.subject,
        body: input.body,
        status: 'SCHEDULED' as EmailStatus,
        idempotencyKey: deriveIdempotencyKey(emailJob.id, r.email),
        scheduledAt: new Date(
          scheduledAt.getTime() + index * input.delayBetweenEmailsMs,
        ),
      }),
    );

    await tx.email.createMany({ data: emailData });

    return emailJob;
  });

  logger.info(
    { jobId: result.id, totalRecipients },
    'Email job and records created in DB',
  );

  // ── Step 2: Fetch the created Email records (need their IDs) ──────────────
  const emailRecords = await prisma.email.findMany({
    where: { jobId: result.id },
    select: {
      id: true,
      recipient: true,
      idempotencyKey: true,
      scheduledAt: true,
    },
    orderBy: { scheduledAt: 'asc' },
  });

  // ── Step 3: Enqueue BullMQ jobs with delays ───────────────────────────────
  // Jobs are delayed relative to now.
  // BullMQ persists all jobs in Redis so they survive server restarts.
  const now = Date.now();
  const enqueuedBullmqIds: string[] = [];
  const failedEnqueues: string[] = [];

  await Promise.allSettled(
    emailRecords.map(async (email) => {
      const delayMs = Math.max(0, email.scheduledAt.getTime() - now);

      const payload: EmailJobPayload = {
        emailId: email.id,
        jobId: result.id,
        idempotencyKey: email.idempotencyKey,
        recipient: email.recipient,
        senderEmail: input.senderEmail,
        senderName: input.senderName ?? 'ReachInbox Mailer',
        subject: input.subject,
        body: input.body,
        hourlyLimit: input.hourlyLimit,
        delayBetweenEmailsMs: input.delayBetweenEmailsMs,
        attemptNumber: 0,
      };

      try {
        const bullmqJobId = await enqueueEmail({
          payload,
          delayMs,
          jobId: email.idempotencyKey, // idempotency key = BullMQ job ID
        });

        // Mark email as QUEUED and store BullMQ job ID
        await prisma.email.update({
          where: { id: email.id },
          data: { status: 'QUEUED', bullmqJobId },
        });

        enqueuedBullmqIds.push(bullmqJobId);
      } catch (err) {
        // Log but don't throw — DB state remains SCHEDULED so a retry is possible
        logger.error(
          { err, emailId: email.id, recipient: email.recipient },
          'Failed to enqueue email — will remain SCHEDULED for manual recovery',
        );
        failedEnqueues.push(email.id);
      }
    }),
  );

  // ── Step 4: Update parent job status ─────────────────────────────────────
  const enqueuedCount = enqueuedBullmqIds.length;
  const newStatus: JobStatus =
    enqueuedCount === 0 ? 'FAILED' : 'RUNNING';

  await prisma.emailJob.update({
    where: { id: result.id },
    data: { status: newStatus, startedAt: new Date() },
  });

  if (failedEnqueues.length > 0) {
    logger.warn(
      { jobId: result.id, failedEnqueues },
      `${failedEnqueues.length} emails failed to enqueue`,
    );
  }

  logger.info(
    { jobId: result.id, enqueuedCount, failedEnqueues: failedEnqueues.length },
    'Email job enqueued successfully',
  );

  // ── Step 5: Bulk Sync to Elasticsearch (Fire-and-forget) ───────────────────
  void bulkSyncEmails(emailRecords.map((e) => e.id));

  return {
    jobId: result.id,
    totalRecipients,
    scheduledAt,
    estimatedCompletionAt: estimateCompletion(
      scheduledAt,
      totalRecipients,
      input.delayBetweenEmailsMs,
    ),
  };
}

// ── List Jobs ──────────────────────────────────────────────────────────────────

export async function listJobs(params: {
  userId: string;
  page: number;
  pageSize: number;
  status?: JobStatus;
}): Promise<{ jobs: JobWithProgress[]; total: number }> {
  const { userId, page, pageSize, status } = params;
  const skip = (page - 1) * pageSize;

  const where: Prisma.EmailJobWhereInput = { userId, ...(status ? { status } : {}) };

  const [jobs, total] = await Promise.all([
    prisma.emailJob.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        subject: true,
        senderEmail: true,
        senderName: true,
        scheduledAt: true,
        delayBetweenEmailsMs: true,
        hourlyLimit: true,
        totalRecipients: true,
        sentCount: true,
        failedCount: true,
        rescheduledCount: true,
        status: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.emailJob.count({ where }),
  ]);

  return { jobs, total };
}

// ── Get Single Job ─────────────────────────────────────────────────────────────

export async function getJobById(
  jobId: string,
  userId: string,
): Promise<JobWithProgress & { emails: unknown[] }> {
  const job = await prisma.emailJob.findFirst({
    where: { id: jobId, userId },
    include: {
      emails: {
        select: {
          id: true,
          recipient: true,
          status: true,
          scheduledAt: true,
          sentAt: true,
          failedAt: true,
          failureReason: true,
          attemptCount: true,
          etherealPreviewUrl: true,
          bullmqJobId: true,
        },
        orderBy: { scheduledAt: 'asc' },
      },
    },
  });

  if (!job) throw AppError.notFound('Email job not found');
  return job as JobWithProgress & { emails: unknown[] };
}

// ── Cancel Job ─────────────────────────────────────────────────────────────────

/**
 * Cancel a job that is PENDING or RUNNING.
 * Marks the job CANCELLED and all non-sent emails CANCELLED.
 * NOTE: This does NOT remove jobs from the BullMQ queue — in-flight jobs
 * will detect CANCELLED status in the worker and skip sending.
 */
export async function cancelJob(
  jobId: string,
  userId: string,
): Promise<void> {
  const job = await prisma.emailJob.findFirst({
    where: { id: jobId, userId },
    select: { id: true, status: true },
  });

  if (!job) throw AppError.notFound('Email job not found');

  if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
    throw AppError.conflict(
      `Cannot cancel a job with status ${job.status}`,
    );
  }

  await prisma.$transaction([
    prisma.emailJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    }),
    prisma.email.updateMany({
      where: {
        jobId,
        status: { notIn: ['SENT', 'FAILED'] },
      },
      data: { status: 'CANCELLED' },
    }),
  ]);

  logger.info({ jobId, userId }, 'Email job cancelled');

  // Sync affected emails to ES (fire-and-forget)
  const affectedEmails = await prisma.email.findMany({
    where: { jobId },
    select: { id: true },
  });
  for (const email of affectedEmails) {
    void syncEmailToElasticsearch(email.id);
  }
}
