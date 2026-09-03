import request from 'supertest';
import express from 'express';
import healthRouter from '../src/routes/health';

// ──────────────────────────────────────────────────────────────────────────────
// Health endpoint tests
// These tests run against the live Docker containers (PostgreSQL, Redis, ES)
// ──────────────────────────────────────────────────────────────────────────────

// Minimal test app — no sessions or passport needed for health routes
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/health', healthRouter);
  return app;
}

describe('GET /health', () => {
  it('returns 200 with alive status', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('alive');
    expect(typeof res.body.data.uptime).toBe('number');
    expect(res.body.data.timestamp).toBeDefined();
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when all deps are healthy (requires running Docker)', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/health/ready');

    // Response shape is always present regardless of health status
    expect(res.body.data).toBeDefined();
    expect(res.body.data.dependencies).toBeDefined();
    expect(res.body.data.dependencies).toHaveProperty('postgresql');
    expect(res.body.data.dependencies).toHaveProperty('redis');
    expect(res.body.data.dependencies).toHaveProperty('elasticsearch');
    expect(res.body.data.dependencies).toHaveProperty('bullmq');

    // If Docker is running, all should be healthy
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ready');
      expect(res.body.data.dependencies.postgresql.status).toBe('ok');
      expect(res.body.data.dependencies.redis.status).toBe('ok');
      expect(res.body.data.dependencies.elasticsearch.status).toBe('ok');
      expect(res.body.data.dependencies.bullmq.status).toBe('ok');
    } else {
      // 503 is acceptable if Docker is not running (e.g., in CI without services)
      expect(res.status).toBe(503);
      expect(res.body.data.status).toBe('degraded');
    }
  });
});
