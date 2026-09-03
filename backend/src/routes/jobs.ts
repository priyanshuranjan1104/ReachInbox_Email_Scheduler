import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  createJob,
  getJobs,
  getJob,
  deleteJob,
  csvUpload,
  simulateJobs,
} from '../controllers/jobs.controller';

// ──────────────────────────────────────────────────────────────────────────────
// Jobs Routes — /api/jobs
// ──────────────────────────────────────────────────────────────────────────────

const router = Router();

// All job routes require authentication
router.use(requireAuth);

/**
 * POST /api/jobs/simulate
 * Simulates enqueuing 1000+ jobs without sending real emails to test load.
 */
router.post('/simulate', simulateJobs);

/**
 * POST /api/jobs
 * Create a new email batch job.
 *
 * Supports two content types:
 *   1. application/json    → recipients as JSON array
 *   2. multipart/form-data → recipients as CSV file upload (field: "recipients")
 *
 * Body fields:
 *   - subject            {string}   required
 *   - body               {string}   required
 *   - senderEmail        {string}   required (valid email)
 *   - senderName         {string}   optional
 *   - recipients         {array}    required (JSON) OR upload (CSV)
 *   - scheduledAt        {ISO date} required
 *   - delayBetweenEmailsMs {number} optional, default 2000
 *   - hourlyLimit        {number}   optional, default 100
 */
router.post('/', csvUpload, createJob);

/**
 * GET /api/jobs?page=1&pageSize=20&status=RUNNING
 * List all jobs belonging to the authenticated user.
 */
router.get('/', getJobs);

/**
 * GET /api/jobs/:id
 * Get a specific job with all its email records.
 */
router.get('/:id', getJob);

/**
 * DELETE /api/jobs/:id
 * Cancel a PENDING or RUNNING job.
 * All un-sent emails in the job are marked CANCELLED.
 */
router.delete('/:id', deleteJob);

export default router;
