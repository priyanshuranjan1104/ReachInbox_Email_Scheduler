import request from 'supertest';
import { createApp } from '../src/index';

// ──────────────────────────────────────────────────────────────────────────────
// Jobs API Integration Tests
//
// These tests use supertest against the real Express app.
// Authentication is bypassed by injecting a fake user into the session.
// ──────────────────────────────────────────────────────────────────────────────

// Minimal test app factory — uses the same createApp() but we can inject
// a test middleware to set req.user (bypasses OAuth).
import express, { Request, Response, NextFunction } from 'express';
import jobsRouter from '../src/routes/jobs';
import { errorHandler } from '../src/middleware/errorHandler';

function buildTestApp() {
  const app = express();
  app.use(express.json());

  // Inject a fake authenticated user
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).user = {
      id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
      avatar: null,
    };
    (req as unknown as Record<string, unknown>).isAuthenticated = () => true;
    next();
  });

  app.use('/api/jobs', jobsRouter);
  app.use(errorHandler);
  return app;
}

describe('POST /api/jobs — input validation', () => {
  const app = buildTestApp();
  const futureDate = new Date(Date.now() + 60_000).toISOString();

  it('returns 400 when subject is missing', async () => {
    const res = await request(app).post('/api/jobs').send({
      body: 'Hello',
      senderEmail: 'sender@test.com',
      recipients: ['a@b.com'],
      scheduledAt: futureDate,
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when recipients array is empty', async () => {
    const res = await request(app).post('/api/jobs').send({
      subject: 'Test',
      body: 'Hello',
      senderEmail: 'sender@test.com',
      recipients: [],
      scheduledAt: futureDate,
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when senderEmail is invalid', async () => {
    const res = await request(app).post('/api/jobs').send({
      subject: 'Test',
      body: 'Hello',
      senderEmail: 'not-an-email',
      recipients: ['a@b.com'],
      scheduledAt: futureDate,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when recipients contains invalid email', async () => {
    const res = await request(app).post('/api/jobs').send({
      subject: 'Test',
      body: 'Hello',
      senderEmail: 'sender@test.com',
      recipients: ['not-valid'],
      scheduledAt: futureDate,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/api/jobs').send({
      subject: 'Test',
      body: '',
      senderEmail: 'sender@test.com',
      recipients: ['a@b.com'],
      scheduledAt: futureDate,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when scheduledAt is malformed', async () => {
    const res = await request(app).post('/api/jobs').send({
      subject: 'Test',
      body: 'Hello',
      senderEmail: 'sender@test.com',
      recipients: ['a@b.com'],
      scheduledAt: 'not-a-date',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/jobs — list jobs', () => {
  const app = buildTestApp();

  it('returns 200 with paginated jobs', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('jobs');
    expect(res.body.data).toHaveProperty('pagination');
    expect(Array.isArray(res.body.data.jobs)).toBe(true);
  });

  it('accepts valid status filter', async () => {
    const res = await request(app).get('/api/jobs?status=COMPLETED');
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid status filter', async () => {
    const res = await request(app).get('/api/jobs?status=INVALID_STATUS');
    expect(res.status).toBe(400);
  });

  it('accepts pagination params', async () => {
    const res = await request(app).get('/api/jobs?page=1&pageSize=5');
    expect(res.status).toBe(200);
    expect(res.body.data.pagination.pageSize).toBe(5);
  });
});

describe('GET /api/jobs/:id — get single job', () => {
  const app = buildTestApp();

  it('returns 404 for non-existent job', async () => {
    const res = await request(app).get('/api/jobs/nonexistent-id-12345');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('DELETE /api/jobs/:id — cancel job', () => {
  const app = buildTestApp();

  it('returns 404 for non-existent job', async () => {
    const res = await request(app).delete('/api/jobs/nonexistent-id-12345');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
