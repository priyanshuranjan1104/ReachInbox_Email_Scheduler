import { Queue, QueueOptions } from 'bullmq';
import { redis } from '../config/redis';
import { env } from '../config/env';

// ──────────────────────────────────────────────────────────────────────────────
// BullMQ Queue Definitions
// ──────────────────────────────────────────────────────────────────────────────

// Queue names — centralised to avoid typos
export const QUEUE_NAMES = {
  EMAIL: 'email-queue',
} as const;

// Shared queue connection options
const queueConnection = {
  connection: redis,
};

// Default job options applied to all email jobs
const defaultJobOptions: QueueOptions['defaultJobOptions'] = {
  // Retry up to 3 times before marking as failed
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5_000, // 5s → 10s → 20s
  },
  // Remove completed jobs after 24 hours (keep last 1000)
  removeOnComplete: { age: 86_400, count: 1_000 },
  // Keep failed jobs for 7 days for inspection via Bull Board
  removeOnFail: { age: 7 * 86_400, count: 5_000 },
};

// ──────────────────────────────────────────────────────────────────────────────
// Email Queue — all email send jobs pass through here
// ──────────────────────────────────────────────────────────────────────────────
export const emailQueue = new Queue(QUEUE_NAMES.EMAIL, {
  ...queueConnection,
  defaultJobOptions,
});

// ──────────────────────────────────────────────────────────────────────────────
// Job Payload Types — define the exact data stored in each BullMQ job
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Data stored in every BullMQ email job.
 * The worker uses this to send the email and update the database.
 */
export interface EmailJobPayload {
  /** DB primary key of the Email record */
  emailId: string;
  /** DB primary key of the EmailJob record */
  jobId: string;
  /** Unique key (SHA-256 of jobId+recipient) — used for idempotency check */
  idempotencyKey: string;

  // Send params
  recipient: string;
  senderEmail: string;
  senderName: string;
  subject: string;
  body: string;

  // Rate-limit config (copied from the job at enqueue time)
  hourlyLimit: number;
  delayBetweenEmailsMs: number;

  // Attempt tracking
  attemptNumber: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper to enqueue a single email job with a delay
// ──────────────────────────────────────────────────────────────────────────────

export interface EnqueueEmailOptions {
  payload: EmailJobPayload;
  /** Milliseconds from now before the job becomes active */
  delayMs?: number;
  /** BullMQ job ID — set to idempotencyKey for deduplication */
  jobId?: string;
}

export async function enqueueEmail({
  payload,
  delayMs = 0,
  jobId,
}: EnqueueEmailOptions): Promise<string> {
  const job = await emailQueue.add(
    'send-email',
    payload,
    {
      delay: delayMs,
      // Using idempotencyKey as the BullMQ job ID prevents exact duplicates
      // from being enqueued (BullMQ deduplicates by ID)
      jobId: jobId ?? payload.idempotencyKey,
    },
  );
  return job.id ?? '';
}

/**
 * Health-check: verify the queue can communicate with Redis.
 */
export async function checkQueueHealth(): Promise<{
  status: 'ok' | 'error';
  queueName: string;
  waitingCount?: number;
  activeCount?: number;
  error?: string;
}> {
  try {
    const [waiting, active] = await Promise.all([
      emailQueue.getWaitingCount(),
      emailQueue.getActiveCount(),
    ]);
    return {
      status: 'ok',
      queueName: QUEUE_NAMES.EMAIL,
      waitingCount: waiting,
      activeCount: active,
    };
  } catch (err) {
    return {
      status: 'error',
      queueName: QUEUE_NAMES.EMAIL,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
