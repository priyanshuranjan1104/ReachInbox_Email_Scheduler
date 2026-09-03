import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';

// ──────────────────────────────────────────────────────────────────────────────
// Search Routes (skeleton — full implementation in Phase 4)
// ──────────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(requireAuth);

/**
 * GET /api/search?q=<query>&status=<sent|scheduled>&page=1&pageSize=20
 * Full-text search across emails using Elasticsearch.
 * TODO (Phase 4): Full implementation.
 */
router.get('/', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Phase 4' } });
});

export default router;
