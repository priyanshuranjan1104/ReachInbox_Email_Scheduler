import { CreateJobSchema, normaliseRecipient } from '../src/schemas/job.schema';

// ──────────────────────────────────────────────────────────────────────────────
// Job Schema Validation Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('CreateJobSchema', () => {
  const validBase = {
    subject: 'Hello World',
    body: 'This is the email body.',
    senderEmail: 'sender@example.com',
    recipients: ['recipient@example.com'],
    scheduledAt: new Date(Date.now() + 60_000).toISOString(), // 1 min in future
  };

  it('accepts a valid minimal payload', () => {
    const result = CreateJobSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delayBetweenEmailsMs).toBe(2000); // default
      expect(result.data.hourlyLimit).toBe(100); // default
      expect(result.data.senderName).toBe('ReachInbox Mailer'); // default
    }
  });

  it('accepts recipients as object array', () => {
    const result = CreateJobSchema.safeParse({
      ...validBase,
      recipients: [{ email: 'alice@test.com', name: 'Alice' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty recipients', () => {
    const result = CreateJobSchema.safeParse({ ...validBase, recipients: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid recipient email', () => {
    const result = CreateJobSchema.safeParse({
      ...validBase,
      recipients: ['not-an-email'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty subject', () => {
    const result = CreateJobSchema.safeParse({ ...validBase, subject: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty body', () => {
    const result = CreateJobSchema.safeParse({ ...validBase, body: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid senderEmail', () => {
    const result = CreateJobSchema.safeParse({
      ...validBase,
      senderEmail: 'not-valid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative delayBetweenEmailsMs', () => {
    const result = CreateJobSchema.safeParse({
      ...validBase,
      delayBetweenEmailsMs: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects hourlyLimit of 0', () => {
    const result = CreateJobSchema.safeParse({
      ...validBase,
      hourlyLimit: 0,
    });
    expect(result.success).toBe(false);
  });

  it('accepts custom delayBetweenEmailsMs and hourlyLimit', () => {
    const result = CreateJobSchema.safeParse({
      ...validBase,
      delayBetweenEmailsMs: 5000,
      hourlyLimit: 50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delayBetweenEmailsMs).toBe(5000);
      expect(result.data.hourlyLimit).toBe(50);
    }
  });

  it('transforms scheduledAt string to Date', () => {
    const result = CreateJobSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scheduledAt).toBeInstanceOf(Date);
    }
  });
});

describe('normaliseRecipient', () => {
  it('normalises a plain email string', () => {
    const result = normaliseRecipient('test@example.com');
    expect(result).toEqual({ email: 'test@example.com' });
  });

  it('normalises an object with email and name', () => {
    const result = normaliseRecipient({ email: 'a@b.com', name: 'Alice' });
    expect(result).toEqual({ email: 'a@b.com', name: 'Alice' });
  });

  it('normalises an object with only email', () => {
    const result = normaliseRecipient({ email: 'a@b.com' });
    expect(result.email).toBe('a@b.com');
    expect(result.name).toBeUndefined();
  });
});
