import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import emailsRouter from '../src/routes/emails';
import { errorHandler } from '../src/middleware/errorHandler';

jest.mock('../src/services/search.service', () => ({
  searchEmails: jest.fn().mockResolvedValue({
    hits: [{ id: 'mocked-hit' }],
    total: 1,
    page: 1,
    pageSize: 20,
  }),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Emails API Integration Tests
// ──────────────────────────────────────────────────────────────────────────────

function buildTestApp() {
  const app = express();
  app.use(express.json());

  // Fake auth middleware
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

  app.use('/api/emails', emailsRouter);
  app.use(errorHandler);
  return app;
}

describe('GET /api/emails', () => {
  const app = buildTestApp();

  it('returns 200 with paginated emails', async () => {
    const res = await request(app).get('/api/emails');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('totalPages');
  });

  it('accepts valid status filter', async () => {
    const res = await request(app).get('/api/emails?status=SENT');
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid status', async () => {
    const res = await request(app).get('/api/emails?status=NOPE');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/emails/scheduled', () => {
  const app = buildTestApp();

  it('returns 200 with scheduled emails', async () => {
    const res = await request(app).get('/api/emails/scheduled');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/emails/sent', () => {
  const app = buildTestApp();

  it('returns 200 with sent emails', async () => {
    const res = await request(app).get('/api/emails/sent');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/emails/:id', () => {
  const app = buildTestApp();

  it('returns 404 for non-existent email', async () => {
    const res = await request(app).get('/api/emails/nonexistent-id-xyz');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/emails/search', () => {
  const app = buildTestApp();

  it('returns 200 and matches PaginatedResponse shape', async () => {
    const res = await request(app).get('/api/emails/search?q=test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('totalPages');
  });
});
