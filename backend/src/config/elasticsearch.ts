import { Client } from '@elastic/elasticsearch';
import { env } from './env';
import { logger } from '../middleware/errorHandler';

// ──────────────────────────────────────────────────────────────────────────────
// Elasticsearch client
// Security is disabled for local dev (docker-compose: xpack.security.enabled=false)
// ──────────────────────────────────────────────────────────────────────────────

export const esClient = new Client({
  node: env.ELASTICSEARCH_URL,
  // Re-enable in production with TLS + auth:
  // auth: { username: 'elastic', password: process.env.ELASTIC_PASSWORD },
  // tls: { rejectUnauthorized: true },
  maxRetries: 3,
  requestTimeout: 10_000,
  sniffOnStart: false,
});

// Index names — centralised so they can be changed in one place
export const ES_INDICES = {
  EMAILS: env.ELASTICSEARCH_INDEX_EMAILS,
} as const;

// Email document mapping for the emails index
export const EMAIL_INDEX_MAPPING = {
  mappings: {
    properties: {
      jobId: { type: 'keyword' },
      emailId: { type: 'keyword' },
      recipient: { type: 'keyword' },
      sender: { type: 'keyword' },
      subject: { type: 'text', analyzer: 'standard' },
      body: { type: 'text', analyzer: 'standard' },
      status: { type: 'keyword' },
      scheduledAt: { type: 'date' },
      sentAt: { type: 'date' },
      createdAt: { type: 'date' },
      userId: { type: 'keyword' },
      idempotencyKey: { type: 'keyword' },
    },
  },
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0, // single-node dev setup
    refresh_interval: '1s',
  },
} as const;

/**
 * Ensure the emails index exists with the correct mapping.
 * Called once at app startup. Safe to call multiple times (idempotent).
 */
export async function ensureElasticsearchIndices(): Promise<void> {
  const indexName = ES_INDICES.EMAILS;

  const exists = await esClient.indices.exists({ index: indexName });
  if (!exists) {
    await esClient.indices.create({
      index: indexName,
      ...EMAIL_INDEX_MAPPING,
    });
    logger.info(`✅ Elasticsearch: created index "${indexName}"`);
  } else {
    logger.info(`✅ Elasticsearch: index "${indexName}" already exists`);
  }
}

/**
 * Health-check: cluster health endpoint.
 */
export async function checkElasticsearchHealth(): Promise<{
  status: 'ok' | 'error';
  clusterStatus?: string;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const health = await esClient.cluster.health();
    return {
      status: 'ok',
      clusterStatus: health.status,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
