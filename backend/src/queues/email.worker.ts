import { Worker, Job, UnrecoverableError } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../middleware/errorHandler';
import { EmailJobPayload, QUEUE_NAMES } from './email.queue';
import { sendEmail } from '../services/email.service';
import { syncEmailToElasticsearch } from '../services/search.service';
import {
  checkRateLimit,
  rescheduleAfterRateLimit,
} from '../services/rateLimit.service';

// ──────────────────────────────────────────────────────────────────────────────
// BullMQ Email Worker — Full Phase 4 Implementation
//
// Idempotency strategy:
//   1. DB check: if email.status === SENT, skip immediately.
//   2. DB check: if parent job is CANCELLED, skip immediately.
//   3. Atomic SENDING transition before sending (prevents two workers racing).
//   4. On success: mark SENT + store messageId + preview URL.
//   5. On final failure: mark FAILED + store reason.
//   6. UnrecoverableError thrown on final failure — BullMQ will not retry.
//
// Restart-safety:
//   - BullMQ delayed jobs persist in Redis and resume automatically.
//   - No startup job-recreation routine needed.
//   - Emails stuck in SENDING after a crash are safe to retry (idempotency key).
// ──────────────────────────────────────────────────────────────────────────────

let worker: Worker<EmailJobPayload> | null = null;

// ── Core Processor ──────────────────────────────────────────────────────────

async function processEmailJob(job: Job<EmailJobPayload>): Promise<void> {
  const {
    emailId,
    jobId,
    idempotencyKey,
    recipient,
    senderEmail,
    senderName,
    subject,
    body,
  } = job.data;

  logger.info(
    { emailId, jobId, recipient, bullmqAttempt: job.attemptsMade },
    '▶ Processing email job',
  );

  // ── Guard 1: Idempotency — check if already sent ─────────────────────────
  const existingEmail = await prisma.email.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true, jobId: true },
  });

  if (!existingEmail) {
    throw new UnrecoverableError(
      `Email record ${emailId} (key=${idempotencyKey}) not found in DB. Cannot process.`,
    );
  }

  if (existingEmail.status === 'SENT') {
    logger.warn(
      { emailId, idempotencyKey },
      '⚡ Idempotency hit — email already SENT. Skipping.',
    );
    return;
  }

  // ── Guard 2: Parent job cancelled ────────────────────────────────────────
  const parentJob = await prisma.emailJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });

  if (parentJob?.status === 'CANCELLED') {
    logger.info({ emailId, jobId }, '🚫 Parent job cancelled — skipping email');
    await prisma.email.update({
      where: { id: emailId },
      data: { status: 'CANCELLED' },
    });
    return;
  }

  // ── Step 2: Crash Recovery Check ─────────────────────────────────────────
  if (existingEmail.status === 'SENDING') {
    logger.warn(
      { emailId, idempotencyKey },
      'Detected stale SENDING state. Previous worker likely crashed. Proceeding with at-least-once delivery.',
    );
  }

  // ── Step 3: Atomic Claim ─────────────────────────────────────────────────
  const claimResult = await prisma.email.updateMany({
    where: {
      id: emailId,
      status: { in: ['QUEUED', 'SENDING', 'SCHEDULED', 'RESCHEDULED'] },
    },
    data: {
      status: 'SENDING',
      attemptCount: { increment: 1 },
    },
  });

  if (claimResult.count === 0) {
    logger.warn(
      { emailId, currentStatus: existingEmail.status },
      '⚡ Email no longer in processable state — skipping (concurrent worker guard)',
    );
    return;
  }

  void syncEmailToElasticsearch(emailId); // Sync SENDING state

  // ── Step 4: Rate Limiting Check ──────────────────────────────────────────
  const limitCheck = await checkRateLimit({
    senderEmail: senderEmail,
    hourlyLimit: job.data.hourlyLimit,
  });

  if (!limitCheck.allowed) {
    await prisma.email.update({
      where: { id: emailId },
      data: { status: 'RATE_LIMITED' },
    });

    const { assignedSlotTimestamp } = await rescheduleAfterRateLimit({
      jobId: jobId,
      emailId: emailId,
      senderEmail: senderEmail,
      rateLimitType: 'PER_SENDER',
      retryAfterMs: limitCheck.retryAfterMs,
      delayBetweenEmailsMs: job.data.delayBetweenEmailsMs,
    });

    await job.moveToDelayed(assignedSlotTimestamp, job.token);
    
    await prisma.emailJob.update({
      where: { id: jobId },
      data: { rescheduledCount: { increment: 1 } },
    });

    void syncEmailToElasticsearch(emailId); // Sync RATE_LIMITED state

    logger.info({ emailId }, 'Job rescheduled due to rate limit');
    return;
  }

  // ── Step 5: Send via SMTP ────────────────────────────────────────────────
  try {
    const { messageId, previewUrl } = await sendEmail({
      recipient,
      senderEmail,
      senderName,
      subject,
      body,
    });

    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        bullmqJobId: job.id ?? null,
        etherealPreviewUrl: typeof previewUrl === 'string' ? previewUrl : null,
        failureReason: null,
      },
    });

    await prisma.emailJob.update({
      where: { id: jobId },
      data: { sentCount: { increment: 1 } },
    });

    await maybeCompleteJob(jobId);

    void syncEmailToElasticsearch(emailId); // Sync SENT state

    logger.info(
      { emailId, recipient, messageId, previewUrl },
      '✅ Email sent successfully',
    );
  } catch (err) {
    logger.error(
      { err, emailId, recipient, bullmqAttempt: job.attemptsMade },
      '❌ Failed to send email',
    );

    const maxAttempts = job.opts.attempts ?? 3;
    const isFinalAttempt = job.attemptsMade >= maxAttempts - 1;

    if (isFinalAttempt) {
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: err instanceof Error ? err.message : String(err),
        },
      });

      await prisma.emailJob.update({
        where: { id: jobId },
        data: { failedCount: { increment: 1 } },
      });

      await maybeCompleteJob(jobId);
      
      void syncEmailToElasticsearch(emailId); // Sync FAILED state

      throw new UnrecoverableError(
        `Email ${emailId} to ${recipient} failed after ${maxAttempts} attempts: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Re-throw for BullMQ exponential backoff retry
    throw err;
  }
}

// ── Helper: complete job if all emails are terminal ─────────────────────────

async function maybeCompleteJob(jobId: string): Promise<void> {
  const { _count } = await prisma.email.aggregate({
    where: {
      jobId,
      status: { notIn: ['SENT', 'FAILED', 'CANCELLED'] },
    },
    _count: true,
  });

  if (_count === 0) {
    await prisma.emailJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    logger.info({ jobId }, '🏁 EmailJob marked COMPLETED — all emails processed');
  }
}

// ── Worker Lifecycle ─────────────────────────────────────────────────────────

export function startEmailWorker(): Worker<EmailJobPayload> {
  if (worker) {
    logger.warn('Email worker already started — returning existing instance');
    return worker;
  }

  worker = new Worker<EmailJobPayload>(QUEUE_NAMES.EMAIL, processEmailJob, {
    connection: redis,
    concurrency: env.WORKER_CONCURRENCY,
    // Global BullMQ throughput limiter — prevents flooding SMTP in bursts.
    // Per-sender rate limiting is handled by Phase 5 rateLimit.service.
    limiter: {
      max: 500,
      duration: 60_000, // max 500 jobs/minute globally
    },
  });

  worker.on('completed', (job) => {
    logger.info(
      { bullmqJobId: job.id, emailId: job.data.emailId },
      'BullMQ job completed',
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      {
        bullmqJobId: job?.id,
        emailId: job?.data.emailId,
        err: err.message,
      },
      'BullMQ job failed',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'BullMQ worker error');
  });

  logger.info(
    { concurrency: env.WORKER_CONCURRENCY, queue: QUEUE_NAMES.EMAIL },
    '🚀 Email worker started',
  );

  return worker;
}

export async function stopEmailWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Email worker stopped gracefully');
  }
}

/** Expose worker reference for testing */
export function getWorkerInstance(): Worker<EmailJobPayload> | null {
  return worker;
}
