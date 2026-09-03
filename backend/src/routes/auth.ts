import { Router, Request, Response } from 'express';
import passport from 'passport';
import { requireAuth } from '../middleware/auth';
import { env } from '../config/env';
import {
  generateSlackOAuthState,
  verifyAndConsumeSlackState,
  buildSlackOAuthUrl,
  exchangeSlackCode,
  saveSlackInstallation,
  getSlackInstallation,
  deleteSlackInstallation,
  updateSlackChannel,
} from '../services/slack.service';

// ──────────────────────────────────────────────────────────────────────────────
// Auth Routes — Google OAuth 2.0 + Slack OAuth
// ──────────────────────────────────────────────────────────────────────────────

const router = Router();

// ── Google OAuth ─────────────────────────────────────────────────────────────

/**
 * GET /api/auth/google
 * Redirects the user to Google's OAuth consent screen.
 */
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] }),
);

/**
 * GET /api/auth/google/callback
 * Google redirects here after consent. Passport verifies the code,
 * upserts the user, and redirects to the frontend dashboard.
 */
router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${env.FRONTEND_URL}/login?error=oauth_failed`,
    failureMessage: true,
  }),
  (_req: Request, res: Response) => {
    // Successful authentication — redirect to frontend
    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  },
);

// ── Slack OAuth ───────────────────────────────────────────────────────────────

/**
 * GET /api/auth/slack
 * Initiates Slack OAuth install flow for the authenticated user.
 *
 * Flow:
 *   1. Generate a cryptographically random state token.
 *   2. Store it in Redis (key: slack:oauth:state:{userId}, TTL: 10 min).
 *   3. Redirect user to Slack's authorization URL.
 *
 * CSRF protection: state ties the redirect to the session.
 */
router.get('/slack', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req.user as { id: string }).id;
    const state = await generateSlackOAuthState(userId);
    const url = buildSlackOAuthUrl(state);
    res.redirect(url);
  } catch (err) {
    res.redirect(`${env.FRONTEND_URL}/settings?error=slack_initiate_failed`);
  }
});

/**
 * GET /api/auth/slack/callback
 * Slack redirects here after workspace installation.
 *
 * Flow:
 *   1. Read `code` and `state` from query params.
 *   2. Verify state against stored Redis value (CSRF check) and consume it.
 *   3. Exchange code for bot token via Slack API.
 *   4. Upsert SlackInstallation in PostgreSQL (reconnect-safe).
 *   5. Redirect user to frontend settings page.
 *
 * Note: `state` carries the userId encoded in it, but we also need the session
 * to identify the user. We use the session user for security and the state
 * only for CSRF verification.
 */
router.get('/slack/callback', requireAuth, async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    return res.redirect(`${env.FRONTEND_URL}/settings?error=slack_denied`);
  }

  if (!code || !state) {
    return res.redirect(`${env.FRONTEND_URL}/settings?error=slack_missing_params`);
  }

  const userId = (req.user as { id: string }).id;

  try {
    // CSRF verification
    const isValid = await verifyAndConsumeSlackState(userId, state);
    if (!isValid) {
      return res.redirect(`${env.FRONTEND_URL}/settings?error=slack_invalid_state`);
    }

    // Exchange code for bot token
    const installation = await exchangeSlackCode(code);

    // Persist (upsert — safe for reconnect)
    await saveSlackInstallation(userId, installation);

    return res.redirect(`${env.FRONTEND_URL}/settings?slack_connected=true`);
  } catch (err) {
    return res.redirect(`${env.FRONTEND_URL}/settings?error=slack_exchange_failed`);
  }
});

/**
 * DELETE /api/auth/slack
 * Disconnect the user's Slack workspace.
 */
router.delete('/slack', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.user as { id: string }).id;
  await deleteSlackInstallation(userId);
  res.json({ success: true, data: { message: 'Slack disconnected' } });
});

/**
 * GET /api/auth/slack/status
 * Returns current Slack connection status for the authenticated user.
 * Does NOT expose the bot token.
 */
router.get('/slack/status', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.user as { id: string }).id;
  const installation = await getSlackInstallation(userId);

  if (!installation) {
    return res.json({
      success: true,
      data: { connected: false },
    });
  }

  return res.json({
    success: true,
    data: {
      connected: true,
      teamName: installation.teamName,
      teamId: installation.teamId,
      notificationChannelId: installation.notificationChannelId,
      installedAt: installation.installedAt,
    },
  });
});

/**
 * PATCH /api/auth/slack/channel
 * Update the notification channel for rate-limit alerts.
 * Body: { channelId: string }
 */
router.patch('/slack/channel', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.user as { id: string }).id;
  const { channelId } = req.body as { channelId?: string };

  if (!channelId || typeof channelId !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'channelId is required' },
    });
  }

  const installation = await getSlackInstallation(userId);
  if (!installation) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Slack not connected' },
    });
  }

  await updateSlackChannel(userId, channelId);
  return res.json({
    success: true,
    data: { message: 'Notification channel updated', channelId },
  });
});

// ── Session ───────────────────────────────────────────────────────────────────

/**
 * GET /api/auth/me
 * Returns the current authenticated user's profile.
 */
router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ success: true, data: { user: req.user } });
});

/**
 * DELETE /api/auth/logout
 * Destroys the session and clears the cookie.
 */
router.delete('/logout', requireAuth, (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      res.status(500).json({ success: false, error: { message: 'Logout failed' } });
      return;
    }
    req.session.destroy(() => {
      res.clearCookie('reachinbox.sid');
      res.json({ success: true, data: { message: 'Logged out successfully' } });
    });
  });
});

export default router;
