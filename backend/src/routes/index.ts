import { Router } from 'express';
import healthRouter from './health';
import authRouter from './auth';
import jobsRouter from './jobs';
import emailsRouter from './emails';
import searchRouter from './search';

// ──────────────────────────────────────────────────────────────────────────────
// Root API Router — mounts all sub-routers
// ──────────────────────────────────────────────────────────────────────────────

const router = Router();

// Health (no auth required)
router.use('/health', healthRouter);

// Auth (Google OAuth, Slack OAuth, logout)
router.use('/api/auth', authRouter);

// Protected API routes
router.use('/api/jobs', jobsRouter);
router.use('/api/emails', emailsRouter);
router.use('/api/search', searchRouter);

export default router;
