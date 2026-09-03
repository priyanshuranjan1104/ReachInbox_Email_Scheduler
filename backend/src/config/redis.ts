import Redis, { RedisOptions } from 'ioredis';
import { env } from './env';
import { logger } from '../middleware/errorHandler';

// ──────────────────────────────────────────────────────────────────────────────
// Redis client — used for:
//   1. BullMQ queue/worker broker
//   2. express-session store (via connect-redis)
//   3. Redis-backed rate-limit counters
// ──────────────────────────────────────────────────────────────────────────────

const redisOptions: RedisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  // Retry strategy — exponential back-off capped at 30s
  retryStrategy: (times: number) => {
    if (times > 10) return null;
    return Math.min(times * 200, 30_000);
  },
  keepAlive: 10_000,
  enableReadyCheck: true,
  maxRetriesPerRequest: null,
};

// Primary Redis client (used by BullMQ and rate limiting)
export const redis = new Redis(redisOptions);

// Dedicated client for express-session store
// (BullMQ requires its own connection — do not share with session store)
export const sessionRedis = new Redis(redisOptions);

redis.on('connect', () => logger.info('✅ Redis: connected'));
redis.on('ready', () => logger.info('✅ Redis: ready'));
redis.on('error', (err) => logger.error({ err }, '❌ Redis error'));
redis.on('close', () => logger.warn('⚠️  Redis: connection closed'));

sessionRedis.on('error', (err) =>
  logger.error({ err }, '❌ Redis session store error')
);

/**
 * Connect both Redis clients.
 * Called once at app startup. Skips if already connected.
 */
export async function connectRedis(): Promise<void> {
  // ioredis auto-connects when first command is issued.
  // We issue a PING to verify connectivity at startup.
  await redis.ping();
  await sessionRedis.ping();
}

/**
 * Disconnect both Redis clients.
 * Called on graceful shutdown.
 */
export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  await sessionRedis.quit();
}

/**
 * Health-check: PING the primary Redis client.
 */
export async function checkRedisHealth(): Promise<{
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const result = await redis.ping();
    if (result !== 'PONG') throw new Error(`Unexpected PING response: ${result}`);
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
