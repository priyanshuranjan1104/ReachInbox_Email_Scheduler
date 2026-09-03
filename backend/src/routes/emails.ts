import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  getEmails,
  getScheduledEmails,
  getSentEmails,
  getEmail,
  searchEmailsApi,
} from '../controllers/emails.controller';

// ──────────────────────────────────────────────────────────────────────────────
// Emails Routes — /api/emails
// ──────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(requireAuth);

/**
 * GET /api/emails?page=1&pageSize=20&status=SENT&jobId=xxx
 * List all emails with optional filters.
 */
router.get('/', getEmails);

/**
 * GET /api/emails/search?q=query
 * Search emails by content or recipient.
 */
router.get('/search', searchEmailsApi);

/**
 * GET /api/emails/scheduled?page=1&pageSize=20&jobId=xxx
 * List emails in QUEUED state (scheduled, not yet sent).
 */
router.get('/scheduled', getScheduledEmails);

/**
 * GET /api/emails/sent?page=1&pageSize=20&jobId=xxx
 * List SENT emails — includes Ethereal preview URLs.
 */
router.get('/sent', getSentEmails);

/**
 * GET /api/emails/:id
 * Get a single email's full details including parent job context.
 */
router.get('/:id', getEmail);

export default router;
