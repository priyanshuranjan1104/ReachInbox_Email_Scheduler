import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { logger } from '../middleware/errorHandler';
import { sendRateLimitSlackNotification } from './slack.service';

// ──────────────────────────────────────────────────────────────────────────────
// Rate Limiting Service (skeleton — full implementation in Phase 4)
//
// Strategy: Redis sliding-window counters via atomic Lua script
// Keys:
//   rl:hourly:<senderEmail>:<YYYY-MM-DD-HH>  → count
//   rl:next_slot:<jobId>                     → timestamp (used for rescheduling packing)
//
// NO in-memory state — all counters live in Redis (persist across restarts).
// ──────────────────────────────────────────────────────────────────────────────

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; reason: string };

/**
 * Atomic Lua script to check and increment hourly rate limit.
 * Arguments:
 * KEYS[1] = Rate limit key (e.g., rl:hourly:sender@test.com:2024-01-01-12)
 * ARGV[1] = Hourly limit
 * ARGV[2] = TTL in seconds (e.g., 7200 for 2 hours)
 * 
 * Returns:
 * 1 if allowed (incremented successfully)
 * 0 if exceeded (limit already reached)
 */
const RATE_LIMIT_LUA_SCRIPT = `
  local current = redis.call("GET", KEYS[1])
  if current and tonumber(current) >= tonumber(ARGV[1]) then
    return 0
  end
  local nextVal = redis.call("INCR", KEYS[1])
  if nextVal == 1 then
    redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
  end
  return 1
`;

function getHourlyKey(senderEmail: string, date: Date = new Date()): string {
  // Format: YYYY-MM-DD-HH (e.g., 2024-01-01-12)
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  return `rl:hourly:${senderEmail}:${yyyy}-${mm}-${dd}-${hh}`;
}

/**
 * Check whether sending an email from `senderEmail` is allowed
 * given the job's `hourlyLimit`. Atomically increments if allowed.
 */
export async function checkRateLimit(params: {
  senderEmail: string;
  hourlyLimit: number;
}): Promise<RateLimitResult> {
  const now = new Date();
  const key = getHourlyKey(params.senderEmail, now);
  
  // 2 hours TTL ensures key cleans up after the hour expires
  const ttlSeconds = 2 * 60 * 60; 

  const result = await redis.eval(
    RATE_LIMIT_LUA_SCRIPT,
    1,
    key,
    params.hourlyLimit,
    ttlSeconds
  ) as number;

  if (result === 1) {
    logger.debug({ senderEmail: params.senderEmail, limit: params.hourlyLimit }, 'Rate limit allowed and incremented');
    return { allowed: true };
  } else {
    // Calculate time until start of next hour
    const nextHour = new Date(now);
    nextHour.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
    const retryAfterMs = nextHour.getTime() - now.getTime();
    
    logger.warn({ senderEmail: params.senderEmail, limit: params.hourlyLimit }, 'Rate limit exceeded');
    return { allowed: false, retryAfterMs, reason: 'Hourly limit reached' };
  }
}

/**
 * No-op: The rate limit is already incremented atomically inside checkRateLimit.
 * We kept this function for interface compatibility if needed, or we could remove it.
 */
export async function incrementRateLimit(params: {
  senderEmail: string;
}): Promise<void> {
  // Handled atomically in checkRateLimit
}

/**
 * Get the current rate-limit state for a sender.
 * Used by the dashboard and Slack notifications.
 */
export async function getRateLimitState(params: {
  senderEmail: string;
}): Promise<{ currentHourCount: number; limit: number }> {
  const key = getHourlyKey(params.senderEmail);
  const countStr = await redis.get(key);
  return { 
    currentHourCount: countStr ? parseInt(countStr, 10) : 0, 
    limit: -1 // Dashboard should provide the specific job limit if needed, as limit is per-job
  };
}

/**
 * Reschedule an email job to retry after the rate-limit window resets.
 * Uses a Redis "next available slot" packing algorithm to preserve the minimum delay
 * between emails within the same job, starting from the next hour.
 */
export async function rescheduleAfterRateLimit(params: {
  jobId: string;
  emailId: string;
  senderEmail: string;
  rateLimitType: 'HOURLY_GLOBAL' | 'PER_SENDER';
  retryAfterMs: number;
  delayBetweenEmailsMs: number;
}): Promise<{ assignedSlotTimestamp: number }> {
  const now = Date.now();
  const nextHourStart = now + params.retryAfterMs;

  const slotKey = `rl:next_slot:${params.jobId}`;
  
  // Lua script to atomically get and increment the next available slot for this job.
  // If the slot doesn't exist or is in the past (before nextHourStart), we initialize it to nextHourStart.
  const PACKING_LUA_SCRIPT = `
    local current = redis.call("GET", KEYS[1])
    local start = tonumber(ARGV[1])
    local delay = tonumber(ARGV[2])
    
    if not current or tonumber(current) < start then
      current = start
    else
      current = tonumber(current)
    end
    
    local nextVal = current + delay
    redis.call("SET", KEYS[1], nextVal, "EX", 86400) -- expire slot tracker after 24h
    return current
  `;

  const assignedSlotTimestamp = await redis.eval(
    PACKING_LUA_SCRIPT,
    1,
    slotKey,
    nextHourStart,
    params.delayBetweenEmailsMs
  ) as number;

  const rescheduledTo = new Date(assignedSlotTimestamp);

  // We only want to log one RateLimitEvent per sender per hour.
  // We can use a Redis SETNX to easily deduplicate the event creation.
  const eventDedupeKey = `rl:event_logged:${getHourlyKey(params.senderEmail, new Date())}`;
  const isFirstEventThisHour = await redis.setnx(eventDedupeKey, '1');
  if (isFirstEventThisHour === 1) {
    await redis.expire(eventDedupeKey, 3600); // 1 hour TTL
    const rateLimitEvent = await prisma.rateLimitEvent.create({
      data: {
        jobId: params.jobId,
        emailId: params.emailId,
        limitType: params.rateLimitType,
        senderEmail: params.senderEmail,
        rescheduledTo, // Use the actual assigned slot time for this specific email
      },
    });
    logger.warn(
      { ...params, rescheduledTo },
      'First rate limit event logged for sender this hour',
    );

    // Look up the job owner to find their Slack installation
    const job = await prisma.emailJob.findUnique({
      where: { id: params.jobId },
      select: { userId: true },
    });

    if (job?.userId) {
      // Fire-and-forget — Slack failure must never block email rescheduling
      void sendRateLimitSlackNotification({
        userId: job.userId,
        rateLimitEventId: rateLimitEvent.id,
        jobId: params.jobId,
        emailId: params.emailId,
        senderEmail: params.senderEmail,
        limitType: params.rateLimitType,
        rescheduledTo,
      }).catch((err: unknown) => {
        logger.error({ err, jobId: params.jobId }, 'Slack notification fire-and-forget failed');
      });
    }
  }

  logger.warn(
    { emailId: params.emailId, rescheduledTo },
    'Email rescheduled to packed slot due to rate limit',
  );
  
  return { assignedSlotTimestamp };
}
