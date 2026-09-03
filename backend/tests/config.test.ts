import { env } from '../src/config/env';

// ──────────────────────────────────────────────────────────────────────────────
// Config / env validation tests
// ──────────────────────────────────────────────────────────────────────────────

describe('Environment configuration', () => {
  it('should parse and export valid env object', () => {
    expect(env).toBeDefined();
    expect(typeof env.PORT).toBe('number');
    expect(env.PORT).toBeGreaterThan(0);
    expect(env.NODE_ENV).toBe('test');
  });

  it('should have correct default values', () => {
    expect(env.WORKER_CONCURRENCY).toBe(2); // set in setup.ts
    expect(env.DEFAULT_DELAY_BETWEEN_EMAILS_MS).toBe(2000);
    expect(env.DEFAULT_HOURLY_LIMIT).toBe(100);
    expect(env.ELASTICSEARCH_INDEX_EMAILS).toBe('emails');
  });

  it('should export all required database/redis/es fields', () => {
    expect(env.DATABASE_URL).toContain('postgresql://');
    expect(env.REDIS_HOST).toBe('localhost');
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.ELASTICSEARCH_URL).toBe('http://localhost:9200');
  });
});
