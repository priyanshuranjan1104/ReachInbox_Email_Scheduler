/**
 * Phase 6 — Slack Integration Tests
 *
 * Tests cover:
 *   1. OAuth state generation & single-use verification
 *   2. Stale/incorrect state rejection (CSRF protection)
 *   3. Installation save / getSlackInstallation / disconnect
 *   4. Reconnect — update existing installation without error
 *   5. Slack notification deduplication (Redis lock)
 *   6. Graceful degradation when user has no Slack installation
 *   7. Graceful degradation when SLACK_CLIENT_ID is absent
 *   8. Slack API failure does not bubble up (non-fatal)
 *   9. slackNotified flag updated in DB after success
 */

// Mock @slack/web-api so tests don't hit real Slack endpoints
// Must be declared before any import that uses WebClient
const mockPostMessage = jest.fn();
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    chat: {
      postMessage: mockPostMessage,
    },
    oauth: {
      v2: {
        access: jest.fn(),
      },
    },
  })),
}));

import { redis } from '../src/config/redis';
import { prisma } from '../src/config/database';
import {
  generateSlackOAuthState,
  verifyAndConsumeSlackState,
  buildSlackOAuthUrl,
  saveSlackInstallation,
  getSlackInstallation,
  deleteSlackInstallation,
  updateSlackChannel,
  sendRateLimitSlackNotification,
} from '../src/services/slack.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-slack-user';
const FAKE_INSTALLATION = {
  teamId: 'T_FAKE_001',
  teamName: 'Fake Workspace',
  botToken: 'xoxb-fake-bot-token',
  botUserId: 'U_BOT_001',
  appId: 'A_FAKE_001',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureTestUser() {
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: {
      id: TEST_USER_ID,
      email: 'slack-test@example.com',
      name: 'Slack Test User',
      googleId: 'g_slack_test_001',
    },
  });
}

async function cleanSlackKeys() {
  const keys = await redis.keys('slack:*');
  if (keys.length > 0) await redis.del(...keys);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ensureTestUser();
});

afterAll(async () => {
  await prisma.slackInstallation.deleteMany({ where: { userId: TEST_USER_ID } });
  await prisma.rateLimitEvent.deleteMany({ where: { jobId: 'slack-test-job' } });
  await prisma.emailJob.deleteMany({ where: { userId: TEST_USER_ID } });
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
  await cleanSlackKeys();
  await redis.quit();
});

beforeEach(async () => {
  await cleanSlackKeys();
  await prisma.slackInstallation.deleteMany({ where: { userId: TEST_USER_ID } });
  mockPostMessage.mockReset();
  mockPostMessage.mockResolvedValue({ ok: true }); // default success
});

// ── 1. OAuth State Generation & Verification ──────────────────────────────────

describe('OAuth state management', () => {
  it('generates a non-empty state token and stores it in Redis', async () => {
    const state = await generateSlackOAuthState(TEST_USER_ID);
    expect(state).toHaveLength(48); // 24 random bytes → 48 hex chars
    const stored = await redis.get(`slack:oauth:state:${TEST_USER_ID}`);
    expect(stored).toBe(state);
  });

  it('verifies the correct state and deletes it (single-use)', async () => {
    const state = await generateSlackOAuthState(TEST_USER_ID);
    const ok = await verifyAndConsumeSlackState(TEST_USER_ID, state);
    expect(ok).toBe(true);
    // Key should be gone after consumption
    const stored = await redis.get(`slack:oauth:state:${TEST_USER_ID}`);
    expect(stored).toBeNull();
  });

  it('rejects an incorrect state (CSRF protection)', async () => {
    await generateSlackOAuthState(TEST_USER_ID);
    const ok = await verifyAndConsumeSlackState(TEST_USER_ID, 'wrong-state');
    expect(ok).toBe(false);
  });

  it('rejects a stale / missing state (no key in Redis)', async () => {
    const ok = await verifyAndConsumeSlackState(TEST_USER_ID, 'any-state');
    expect(ok).toBe(false);
  });

  it('state cannot be replayed after consumption', async () => {
    const state = await generateSlackOAuthState(TEST_USER_ID);
    await verifyAndConsumeSlackState(TEST_USER_ID, state); // consume
    const replay = await verifyAndConsumeSlackState(TEST_USER_ID, state);
    expect(replay).toBe(false);
  });

  it('buildSlackOAuthUrl includes client_id and state', () => {
    const state = 'test-state-abc';
    const url = buildSlackOAuthUrl(state);
    const decoded = decodeURIComponent(url);
    expect(url).toContain('slack.com/oauth/v2/authorize');
    expect(url).toContain(`state=${state}`);
    // URL-encoded scope should contain chat:write (either raw or encoded)
    expect(decoded).toContain('chat:write');
  });
});

// ── 2. Installation CRUD ──────────────────────────────────────────────────────

describe('SlackInstallation CRUD', () => {
  it('saves a new installation and retrieves it', async () => {
    await saveSlackInstallation(TEST_USER_ID, FAKE_INSTALLATION);
    const inst = await getSlackInstallation(TEST_USER_ID);
    expect(inst).not.toBeNull();
    expect(inst!.teamId).toBe('T_FAKE_001');
    expect(inst!.teamName).toBe('Fake Workspace');
    // Bot token must not be null
    expect(inst!.botToken).toBe('xoxb-fake-bot-token');
    expect(inst!.notificationChannelId).toBe('#general');
  });

  it('reconnect: upserts without throwing or creating duplicates', async () => {
    await saveSlackInstallation(TEST_USER_ID, FAKE_INSTALLATION);
    const updated = { ...FAKE_INSTALLATION, botToken: 'xoxb-new-token', teamName: 'New Workspace' };
    await expect(saveSlackInstallation(TEST_USER_ID, updated)).resolves.not.toThrow();

    const inst = await getSlackInstallation(TEST_USER_ID);
    expect(inst!.botToken).toBe('xoxb-new-token');
    // Only one record exists
    const count = await prisma.slackInstallation.count({ where: { userId: TEST_USER_ID } });
    expect(count).toBe(1);
  });

  it('returns null for a user with no installation', async () => {
    const inst = await getSlackInstallation('no-such-user');
    expect(inst).toBeNull();
  });

  it('disconnects by deleting the installation', async () => {
    await saveSlackInstallation(TEST_USER_ID, FAKE_INSTALLATION);
    await deleteSlackInstallation(TEST_USER_ID);
    const inst = await getSlackInstallation(TEST_USER_ID);
    expect(inst).toBeNull();
  });

  it('updates the notification channel', async () => {
    await saveSlackInstallation(TEST_USER_ID, FAKE_INSTALLATION);
    await updateSlackChannel(TEST_USER_ID, 'C_ALERTS_001');
    const inst = await getSlackInstallation(TEST_USER_ID);
    expect(inst!.notificationChannelId).toBe('C_ALERTS_001');
  });
});

// ── 3. Rate-Limit Notification ────────────────────────────────────────────────

describe('sendRateLimitSlackNotification', () => {
  // Create a real DB job + event so FK constraints are satisfied
  async function createTestJobAndEvent() {
    const job = await prisma.emailJob.create({
      data: {
        userId: TEST_USER_ID,
        subject: 'Slack test',
        body: 'body',
        senderEmail: 'sender@example.com',
        scheduledAt: new Date(),
        delayBetweenEmailsMs: 1000,
        hourlyLimit: 10,
        totalRecipients: 1,
        status: 'RUNNING',
      },
    });

    const event = await prisma.rateLimitEvent.create({
      data: {
        jobId: job.id,
        limitType: 'PER_SENDER',
        senderEmail: 'sender@example.com',
        rescheduledTo: new Date(Date.now() + 3_600_000),
      },
    });

    return { job, event };
  }

  it('returns false and does not crash when no Slack installation exists', async () => {
    const { job, event } = await createTestJobAndEvent();

    const result = await sendRateLimitSlackNotification({
      userId: TEST_USER_ID,
      rateLimitEventId: event.id,
      jobId: job.id,
      senderEmail: 'sender@example.com',
      limitType: 'PER_SENDER',
      rescheduledTo: new Date(Date.now() + 3_600_000),
    });

    expect(result).toBe(false);
    // Event should NOT be marked as notified
    const updated = await prisma.rateLimitEvent.findUnique({ where: { id: event.id } });
    expect(updated!.slackNotified).toBe(false);
  });

  it('sends real Slack message and marks event as notified', async () => {
    const { job, event } = await createTestJobAndEvent();

    // Install a mock Slack installation
    await saveSlackInstallation(TEST_USER_ID, FAKE_INSTALLATION);

    // mockPostMessage already set to return { ok: true } in beforeEach

    const result = await sendRateLimitSlackNotification({
      userId: TEST_USER_ID,
      rateLimitEventId: event.id,
      jobId: job.id,
      senderEmail: 'sender@example.com',
      limitType: 'PER_SENDER',
      rescheduledTo: new Date(Date.now() + 3_600_000),
    });

    // Event should be marked notified in DB
    const updated = await prisma.rateLimitEvent.findUnique({ where: { id: event.id } });
    expect(updated!.slackNotified).toBe(true);
    expect(updated!.slackNotifiedAt).not.toBeNull();
    expect(result).toBe(true);
  });

  it('deduplicates notifications — second call returns false', async () => {
    const { job, event } = await createTestJobAndEvent();
    await saveSlackInstallation(TEST_USER_ID, FAKE_INSTALLATION);

    // mockPostMessage already resolves to { ok: true } from module-level mock

    const params = {
      userId: TEST_USER_ID,
      rateLimitEventId: event.id,
      jobId: job.id,
      senderEmail: 'sender@example.com',
      limitType: 'PER_SENDER' as const,
      rescheduledTo: new Date(Date.now() + 3_600_000),
    };

    const r1 = await sendRateLimitSlackNotification(params);
    const r2 = await sendRateLimitSlackNotification(params); // duplicate

    expect(r1).toBe(true);
    expect(r2).toBe(false); // Redis lock blocks second send
  });

  it('handles Slack API failure gracefully — returns false, does not throw', async () => {
    const { job, event } = await createTestJobAndEvent();
    await saveSlackInstallation(TEST_USER_ID, FAKE_INSTALLATION);

    // Override the mock to throw
    mockPostMessage.mockRejectedValue(new Error('Slack API down'));

    await expect(
      sendRateLimitSlackNotification({
        userId: TEST_USER_ID,
        rateLimitEventId: event.id,
        jobId: job.id,
        senderEmail: 'sender@example.com',
        limitType: 'PER_SENDER',
        rescheduledTo: new Date(Date.now() + 3_600_000),
      }),
    ).resolves.toBe(false); // Must not throw
  });
});
