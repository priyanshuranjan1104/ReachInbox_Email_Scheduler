import { WebClient } from '@slack/web-api';
import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../middleware/errorHandler';
import { env } from '../config/env';
import crypto from 'crypto';

// ──────────────────────────────────────────────────────────────────────────────
// Slack Service — Phase 6
//
// Architecture:
//   - OAuth handled manually using @slack/web-api (no @slack/oauth install-provider
//     complexity) to keep the flow transparent and testable.
//   - One SlackInstallation per user (unique userId FK).
//   - Bot token stored in PostgreSQL (encrypt via KMS in production).
//   - Notifications fired when rate-limit event is first logged (deduped by Redis).
//   - If Slack is not configured, all functions degrade gracefully (no crash).
//   - If Slack is re-connected, the next rate-limit event picks up the new token.
// ──────────────────────────────────────────────────────────────────────────────

// ── OAuth State Management ────────────────────────────────────────────────────

/**
 * Generate a cryptographically random OAuth state token.
 * Stored in Redis for CSRF verification during callback.
 *
 * Key: slack:oauth:state:{userId}   TTL: 10 minutes
 */
export async function generateSlackOAuthState(userId: string): Promise<string> {
  const state = crypto.randomBytes(24).toString('hex');
  // Store state in Redis with 10-minute TTL
  await redis.setex(`slack:oauth:state:${userId}`, 600, state);
  return state;
}

/**
 * Verify and consume the OAuth state.
 * Returns true if state matches and is within TTL; deletes key after use (single-use).
 */
export async function verifyAndConsumeSlackState(
  userId: string,
  receivedState: string,
): Promise<boolean> {
  const key = `slack:oauth:state:${userId}`;
  const stored = await redis.get(key);
  if (!stored || stored !== receivedState) return false;
  await redis.del(key); // Consume — one-time use
  return true;
}

/**
 * Build the Slack OAuth authorization URL.
 * Scopes: chat:write (post to channels), chat:write.public (post without joining)
 */
export function buildSlackOAuthUrl(state: string): string {
  const scopes = ['chat:write', 'chat:write.public', 'channels:read'].join(',');
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID ?? '',
    scope: scopes,
    redirect_uri: env.SLACK_REDIRECT_URI ?? '',
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

// ── OAuth Callback (Token Exchange) ──────────────────────────────────────────

export type SlackOAuthResult = {
  teamId: string;
  teamName: string;
  botToken: string;
  botUserId: string;
  appId: string;
};

/**
 * Exchange an OAuth code for a bot token via Slack's oauth.v2.access endpoint.
 * Returns the installation data; caller is responsible for persisting.
 */
export async function exchangeSlackCode(code: string): Promise<SlackOAuthResult> {
  const client = new WebClient();
  const response = await client.oauth.v2.access({
    client_id: env.SLACK_CLIENT_ID ?? '',
    client_secret: env.SLACK_CLIENT_SECRET ?? '',
    code,
    redirect_uri: env.SLACK_REDIRECT_URI ?? '',
  });

  if (!response.ok || !response.access_token) {
    throw new Error(`Slack OAuth exchange failed: ${response.error ?? 'unknown error'}`);
  }

  // Type-assert to access nested fields the SDK types may miss
  const data = response as unknown as Record<string, unknown>;
  const team = data['team'] as { id: string; name: string } | undefined;
  const botUser = data['bot_user_id'] as string | undefined;
  const appId = data['app_id'] as string | undefined;

  return {
    teamId: team?.id ?? 'unknown',
    teamName: team?.name ?? 'Unknown Workspace',
    botToken: response.access_token,
    botUserId: botUser ?? 'unknown',
    appId: appId ?? 'unknown',
  };
}

// ── Installation Storage ──────────────────────────────────────────────────────

/**
 * Upsert a Slack installation for a user.
 * This makes reconnect work: same userId gets token updated without re-migrate.
 */
export async function saveSlackInstallation(
  userId: string,
  data: SlackOAuthResult,
  channelId?: string,
): Promise<void> {
  await prisma.slackInstallation.upsert({
    where: { userId },
    create: {
      userId,
      teamId: data.teamId,
      teamName: data.teamName,
      botToken: data.botToken,
      botUserId: data.botUserId,
      appId: data.appId,
      notificationChannelId: channelId ?? '#general',
    },
    update: {
      teamId: data.teamId,
      teamName: data.teamName,
      botToken: data.botToken,
      botUserId: data.botUserId,
      appId: data.appId,
      // Preserve existing channel preference on re-connect
    },
  });
  logger.info({ userId, teamId: data.teamId }, 'Slack installation saved');
}

/**
 * Get the Slack installation for a user, or null if not connected.
 */
export async function getSlackInstallation(userId: string) {
  return prisma.slackInstallation.findUnique({ where: { userId } });
}

/**
 * Delete a user's Slack installation (disconnect).
 */
export async function deleteSlackInstallation(userId: string): Promise<void> {
  await prisma.slackInstallation.deleteMany({ where: { userId } });
  logger.info({ userId }, 'Slack installation removed');
}

/**
 * Update the notification channel for a user's installation.
 */
export async function updateSlackChannel(
  userId: string,
  channelId: string,
): Promise<void> {
  await prisma.slackInstallation.update({
    where: { userId },
    data: { notificationChannelId: channelId },
  });
}

// ── Rate-Limit Notifications ──────────────────────────────────────────────────

export type RateLimitNotificationParams = {
  /** The userId who owns the job — used to look up their Slack installation */
  userId: string;
  rateLimitEventId: string;
  jobId: string;
  emailId?: string;
  senderEmail: string;
  limitType: 'HOURLY_GLOBAL' | 'PER_SENDER';
  rescheduledTo: Date;
};

/**
 * Send a Slack notification for a rate-limit event.
 *
 * Guarantees:
 *   - If the user has no Slack installation, returns false silently (no crash).
 *   - Updates slackNotified=true on the RateLimitEvent exactly once.
 *   - Uses a Redis lock to prevent duplicate notifications if two workers fire.
 *   - Slack API failure is caught and logged; does NOT block email delivery.
 *
 * NOT exactly-once: if the process crashes after Slack accepts the message but
 * before the DB updates slackNotified=true, the notification may be sent twice.
 * This is documented as a known distributed-systems limitation.
 */
export async function sendRateLimitSlackNotification(
  params: RateLimitNotificationParams,
): Promise<boolean> {
  // Guard: is Slack configured at all?
  if (!env.SLACK_CLIENT_ID) {
    logger.debug('Slack not configured — skipping notification');
    return false;
  }

  // Guard: look up the user's Slack installation dynamically
  // (so reconnect works without restarting the server)
  const installation = await getSlackInstallation(params.userId);
  if (!installation) {
    logger.debug({ userId: params.userId }, 'No Slack installation for user — skipping notification');
    return false;
  }

  // Distributed deduplication: only one worker sends the notification per event
  const lockKey = `slack:notify:lock:${params.rateLimitEventId}`;
  const acquired = await redis.setnx(lockKey, '1');
  if (acquired === 0) {
    logger.debug({ rateLimitEventId: params.rateLimitEventId }, 'Slack notification already sent or in-progress');
    return false;
  }
  // 5-minute lock TTL — prevents stale locks if the process crashes
  await redis.expire(lockKey, 300);

  try {
    const client = new WebClient(installation.botToken);
    const limitTypeText =
      params.limitType === 'HOURLY_GLOBAL'
        ? 'Global hourly limit reached'
        : `Per-sender limit reached for \`${params.senderEmail}\``;

    const retryAt = params.rescheduledTo.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    await client.chat.postMessage({
      channel: installation.notificationChannelId,
      text: `⚠️ Rate Limit Hit — ${limitTypeText}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '⚠️ ReachInbox Rate Limit Alert',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Type:*\n${limitTypeText}` },
            { type: 'mrkdwn', text: `*Sender:*\n${params.senderEmail}` },
            { type: 'mrkdwn', text: `*Job ID:*\n\`${params.jobId}\`` },
            { type: 'mrkdwn', text: `*Emails retry at:*\n${retryAt}` },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Event ID: \`${params.rateLimitEventId}\` — affected emails rescheduled automatically`,
            },
          ],
        },
      ],
    });

    // Mark the event as Slack-notified in the DB
    await prisma.rateLimitEvent.update({
      where: { id: params.rateLimitEventId },
      data: { slackNotified: true, slackNotifiedAt: new Date() },
    });

    logger.info(
      { rateLimitEventId: params.rateLimitEventId, userId: params.userId },
      '✅ Slack rate-limit notification sent',
    );
    return true;
  } catch (err) {
    // Release the lock so a retry can attempt again
    await redis.del(lockKey);
    logger.error(
      { err, rateLimitEventId: params.rateLimitEventId },
      '❌ Failed to send Slack notification (non-fatal)',
    );
    return false;
  }
}
