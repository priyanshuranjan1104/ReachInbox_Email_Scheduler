import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { createClient } from 'redis';
import RedisStore from 'connect-redis';
import passport from 'passport';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { logger } from './middleware/errorHandler';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis, sessionRedis } from './config/redis';
import { ensureElasticsearchIndices } from './config/elasticsearch';
import { configurePassport } from './services/auth.service';
import { startEmailWorker, stopEmailWorker } from './queues/email.worker';
import { emailQueue } from './queues/email.queue';
import { errorHandler } from './middleware/errorHandler';
import apiRouter from './routes';

// ── Bull Board dashboard ────────────────────────────────────────────────────
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

// ──────────────────────────────────────────────────────────────────────────────
// Express Application Factory
// ──────────────────────────────────────────────────────────────────────────────

export function createApp(): express.Application {
  const app = express();

  // ── Security headers ──────────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: env.NODE_ENV === 'production',
    crossOriginEmbedderPolicy: false, // needed for Bull Board iframes
  }));

  // ── CORS ──────────────────────────────────────────────────────────────────
  app.use(cors({
    origin: env.CORS_ORIGIN,
    credentials: true, // required for session cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // ── HTTP request logging ─────────────────────────────────────────────────
  if (env.NODE_ENV !== 'test') {
    app.use(pinoHttp({ logger }));
  }

  // ── Body parsers ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ── Session store (Redis-backed) ─────────────────────────────────────────
  // Using connect-redis v7 with ioredis client
  const redisStore = new RedisStore({
    client: sessionRedis as unknown as ReturnType<typeof createClient>,
    prefix: 'sess:',
    ttl: Math.floor(env.SESSION_MAX_AGE_MS / 1000),
  });

  app.use(
    session({
      store: redisStore,
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      name: 'reachinbox.sid',
      cookie: {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
        maxAge: env.SESSION_MAX_AGE_MS,
      },
    }),
  );

  // ── Passport ──────────────────────────────────────────────────────────────
  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());

  // ── Bull Board dashboard ──────────────────────────────────────────────────
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullMQAdapter(emailQueue)],
    serverAdapter,
  });

  app.use('/admin/queues', serverAdapter.getRouter());

  // ── API Routes ────────────────────────────────────────────────────────────
  app.use(apiRouter);

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  // ── Global error handler (must be last) ───────────────────────────────────
  app.use(errorHandler);

  return app;
}

// ──────────────────────────────────────────────────────────────────────────────
// Bootstrap — connect all services and start the server
// ──────────────────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  logger.info('Starting ReachInbox backend...');

  try {
    // Connect to all external services in parallel
    await Promise.all([
      connectDatabase().then(() => logger.info('✅ PostgreSQL connected')),
      connectRedis().then(() => logger.info('✅ Redis connected')),
    ]);

    // Ensure Elasticsearch index exists
    await ensureElasticsearchIndices();

    // Start the BullMQ worker
    startEmailWorker();

    // Create and start the HTTP server
    const app = createApp();
    const server = app.listen(env.PORT, () => {
      logger.info(`✅ API server running at http://localhost:${env.PORT}`);
      logger.info(`📊 BullMQ dashboard: http://localhost:${env.PORT}/admin/queues`);
      logger.info(`🏥 Health check:     http://localhost:${env.PORT}/health/ready`);
    });

    // ── Graceful shutdown ─────────────────────────────────────────────────
    const shutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, 'Shutdown signal received — gracefully stopping...');

      // Stop accepting new connections
      server.close(async () => {
        try {
          await stopEmailWorker();
          await disconnectDatabase();
          await disconnectRedis();
          logger.info('Graceful shutdown complete');
          process.exit(0);
        } catch (err) {
          logger.error({ err }, 'Error during shutdown');
          process.exit(1);
        }
      });

      // Force exit after 30s
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30_000);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// Only run bootstrap when executed directly (not when imported in tests)
if (require.main === module) {
  void bootstrap();
}
