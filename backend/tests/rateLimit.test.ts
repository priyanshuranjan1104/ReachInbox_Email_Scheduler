import { redis } from '../src/config/redis';
import { prisma } from '../src/config/database';
import { checkRateLimit, rescheduleAfterRateLimit } from '../src/services/rateLimit.service';

describe('Distributed Rate Limiting', () => {
  const senderEmail = 'test-concurrent@example.com';
  
  beforeEach(async () => {
    // Clear all rl keys
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    await prisma.emailJob.deleteMany({ where: { userId: 'test-rl-user' } });
    await prisma.user.deleteMany({ where: { id: 'test-rl-user' } });
    await redis.quit();
  });

  it('atomically enforces the exact limit under concurrent execution', async () => {
    const limit = 10;
    const concurrentWorkers = 50;
    
    // Simulate 50 concurrent workers trying to send an email at the exact same millisecond
    const promises = Array.from({ length: concurrentWorkers }).map(() => 
      checkRateLimit({ senderEmail, hourlyLimit: limit })
    );

    const results = await Promise.all(promises);
    
    const allowed = results.filter(r => r.allowed);
    const denied = results.filter(r => !r.allowed);

    // No matter how many concurrent requests, exactly `limit` should be allowed
    expect(allowed.length).toBe(limit);
    expect(denied.length).toBe(concurrentWorkers - limit);
  });

  it('rescheduleAfterRateLimit packs slots respecting minimum delay', async () => {
    await prisma.user.upsert({
      where: { id: 'test-rl-user' },
      update: {},
      create: {
        id: 'test-rl-user',
        email: 'rl-user@example.com',
        name: 'RL User',
        googleId: 'dummy-google-id',
      }
    });

    const job = await prisma.emailJob.create({
      data: {
        userId: 'test-rl-user',
        subject: 'test',
        body: 'test',
        senderEmail,
        scheduledAt: new Date(),
        delayBetweenEmailsMs: 5000,
        hourlyLimit: 10,
        totalRecipients: 3,
        status: 'PENDING'
      }
    });
    
    const emailData = [
      { jobId: job.id, recipient: 'a@b.com', subject: 't', body: 't', idempotencyKey: 'k1', scheduledAt: new Date() },
      { jobId: job.id, recipient: 'b@b.com', subject: 't', body: 't', idempotencyKey: 'k2', scheduledAt: new Date() },
      { jobId: job.id, recipient: 'c@b.com', subject: 't', body: 't', idempotencyKey: 'k3', scheduledAt: new Date() }
    ];
    await prisma.email.createMany({ data: emailData });
    const emails = await prisma.email.findMany({ where: { jobId: job.id }, orderBy: { id: 'asc' } });

    const delayBetweenEmailsMs = 5000; // 5 seconds
    
    // Assume limit is hit and we reschedule 3 emails
    const r1 = await rescheduleAfterRateLimit({
      jobId: job.id,
      emailId: emails[0].id,
      senderEmail,
      rateLimitType: 'PER_SENDER',
      retryAfterMs: 60000,
      delayBetweenEmailsMs,
    });

    const r2 = await rescheduleAfterRateLimit({
      jobId: job.id,
      emailId: emails[1].id,
      senderEmail,
      rateLimitType: 'PER_SENDER',
      retryAfterMs: 60000, // same base retry 
      delayBetweenEmailsMs,
    });

    const r3 = await rescheduleAfterRateLimit({
      jobId: job.id,
      emailId: emails[2].id,
      senderEmail,
      rateLimitType: 'PER_SENDER',
      retryAfterMs: 60000,
      delayBetweenEmailsMs,
    });

    // The slots should be exactly 5 seconds apart
    expect(r2.assignedSlotTimestamp - r1.assignedSlotTimestamp).toBe(5000);
    expect(r3.assignedSlotTimestamp - r2.assignedSlotTimestamp).toBe(5000);
  });
});
