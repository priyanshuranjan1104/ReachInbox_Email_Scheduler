import { deriveIdempotencyKey } from '../src/services/job.service';
import crypto from 'crypto';

// ──────────────────────────────────────────────────────────────────────────────
// Idempotency Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('deriveIdempotencyKey', () => {
  it('produces a 64-char hex string (SHA-256)', () => {
    const key = deriveIdempotencyKey('job-abc', 'test@example.com');
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(key)).toBe(true);
  });

  it('is deterministic — same inputs always produce the same key', () => {
    const key1 = deriveIdempotencyKey('job-abc', 'test@example.com');
    const key2 = deriveIdempotencyKey('job-abc', 'test@example.com');
    expect(key1).toBe(key2);
  });

  it('produces different keys for different jobs with the same recipient', () => {
    const key1 = deriveIdempotencyKey('job-001', 'test@example.com');
    const key2 = deriveIdempotencyKey('job-002', 'test@example.com');
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for same job with different recipients', () => {
    const key1 = deriveIdempotencyKey('job-abc', 'alice@example.com');
    const key2 = deriveIdempotencyKey('job-abc', 'bob@example.com');
    expect(key1).not.toBe(key2);
  });

  it('matches manual SHA-256 computation', () => {
    const jobId = 'test-job-id';
    const recipient = 'user@example.com';
    const expected = crypto
      .createHash('sha256')
      .update(`${jobId}\x00${recipient}`)
      .digest('hex');
    expect(deriveIdempotencyKey(jobId, recipient)).toBe(expected);
  });

  it('handles special characters in recipient email', () => {
    const key = deriveIdempotencyKey('job-x', 'user+tag@sub.domain.com');
    expect(key).toHaveLength(64);
  });
});
