import { Router, Request, Response } from 'express';
import {
  checkDatabaseHealth,
  checkRedisHealth,
  checkElasticsearchHealth,
} from '../config';
import { checkQueueHealth } from '../queues/email.queue';

// ──────────────────────────────────────────────────────────────────────────────
// Health-Check Routes
// GET /health          — quick liveness probe (always 200 if process is alive)
// GET /health/ready    — readiness probe (checks all external deps)
// GET /health/deps     — detailed per-dependency status
// ──────────────────────────────────────────────────────────────────────────────

const router = Router();

/** Liveness — is the process running? */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env['NODE_ENV'] ?? 'unknown',
    },
  });
});

/** Readiness + detailed dependency status */
router.get('/ready', async (_req: Request, res: Response) => {
  const [db, redis, elasticsearch, queue] = await Promise.allSettled([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkElasticsearchHealth(),
    checkQueueHealth(),
  ]);

  const deps = {
    postgresql: db.status === 'fulfilled' ? db.value : { status: 'error', error: String((db as PromiseRejectedResult).reason) },
    redis:      redis.status === 'fulfilled' ? redis.value : { status: 'error', error: String((redis as PromiseRejectedResult).reason) },
    elasticsearch: elasticsearch.status === 'fulfilled' ? elasticsearch.value : { status: 'error', error: String((elasticsearch as PromiseRejectedResult).reason) },
    bullmq:     queue.status === 'fulfilled' ? queue.value : { status: 'error', error: String((queue as PromiseRejectedResult).reason) },
  };

  const allHealthy = Object.values(deps).every((d) => d.status === 'ok');

  res.status(allHealthy ? 200 : 503).json({
    success: allHealthy,
    data: {
      status: allHealthy ? 'ready' : 'degraded',
      timestamp: new Date().toISOString(),
      dependencies: deps,
    },
  });
});

export default router;
