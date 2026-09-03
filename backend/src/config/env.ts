import 'dotenv/config';
import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────────
// Environment variable schema — validated at startup.
// App will throw and refuse to start if any required var is missing.
// ──────────────────────────────────────────────────────────────────────────────
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),

  // Session
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),
  SESSION_MAX_AGE_MS: z.coerce.number().int().positive().default(86_400_000),

  // PostgreSQL / Prisma
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_URL: z.string().optional(),

  // Elasticsearch
  ELASTICSEARCH_URL: z.string().url().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX_EMAILS: z.string().default('emails'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_CALLBACK_URL: z.string().url(),

  // Slack OAuth
  SLACK_CLIENT_ID: z.string().min(1, 'SLACK_CLIENT_ID is required'),
  SLACK_CLIENT_SECRET: z.string().min(1, 'SLACK_CLIENT_SECRET is required'),
  SLACK_SIGNING_SECRET: z.string().min(1, 'SLACK_SIGNING_SECRET is required'),
  SLACK_REDIRECT_URI: z.string().url(),
  SLACK_STATE_SECRET: z.string().min(16, 'SLACK_STATE_SECRET must be at least 16 chars'),

  // BullMQ Worker
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  DEFAULT_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().int().min(0).default(2000),
  DEFAULT_HOURLY_LIMIT: z.coerce.number().int().min(1).default(100),

  // Frontend / CORS
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

// In test mode, relax OAuth requirement (tests don't need real OAuth)
const testSchema = envSchema.partial({
  GOOGLE_CLIENT_ID: true,
  GOOGLE_CLIENT_SECRET: true,
  GOOGLE_CALLBACK_URL: true,
  SLACK_CLIENT_ID: true,
  SLACK_CLIENT_SECRET: true,
  SLACK_SIGNING_SECRET: true,
  SLACK_REDIRECT_URI: true,
  SLACK_STATE_SECRET: true,
});

function parseEnv() {
  const isTest = process.env['NODE_ENV'] === 'test';
  const schema = isTest ? testSchema : envSchema;

  const result = schema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:\n');
    result.error.issues.forEach((issue) => {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    });
    console.error('\nCheck your .env file against .env.example\n');
    process.exit(1);
  }

  return result.data;
}

export const env = parseEnv();
export type Env = typeof env;
