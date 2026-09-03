import { Request, Response, NextFunction } from 'express';
import { listEmails, getEmailById } from '../services/emailQuery.service';
import { searchEmails } from '../services/search.service';
import { AppError } from '../middleware/errorHandler';
import { ListEmailsQuerySchema, EmailIdParamSchema } from '../schemas/job.schema';
import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────────
// Emails Controller — handles HTTP layer for /api/emails
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/emails
 * List emails with optional filters (status, jobId) and pagination.
 */
export async function getEmails(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(AppError.unauthorized());

    const query = ListEmailsQuerySchema.safeParse(req.query);
    if (!query.success) {
      return next(AppError.badRequest('Invalid query parameters', query.error.issues));
    }

    const result = await listEmails({ ...query.data, userId: user.id });

    res.json({
      success: true,
      data: result.emails,
      meta: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / result.pageSize),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/emails/scheduled
 * Convenience alias — list emails with status SCHEDULED or QUEUED.
 */
export async function getScheduledEmails(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(AppError.unauthorized());

    const query = ListEmailsQuerySchema.safeParse({
      ...req.query,
      status: 'QUEUED',
    });
    if (!query.success) {
      return next(AppError.badRequest('Invalid query parameters', query.error.issues));
    }

    const result = await listEmails({ ...query.data, userId: user.id });
    res.json({
      success: true,
      data: result.emails,
      meta: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / result.pageSize),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/emails/sent
 * Convenience alias — list emails with status SENT, includes Ethereal preview URLs.
 */
export async function getSentEmails(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(AppError.unauthorized());

    const query = ListEmailsQuerySchema.safeParse({
      ...req.query,
      status: 'SENT',
    });
    if (!query.success) {
      return next(AppError.badRequest('Invalid query parameters', query.error.issues));
    }

    const result = await listEmails({ ...query.data, userId: user.id });
    res.json({
      success: true,
      data: result.emails,
      meta: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / result.pageSize),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/emails/:id
 * Get a single email's full details.
 */
export async function getEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(AppError.unauthorized());

    const params = EmailIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return next(AppError.badRequest('Invalid email ID'));
    }

    const email = await getEmailById(params.data.id, user.id);
    res.json({ success: true, data: { email } });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/emails/search ───────────────────────────────────────────────────

export async function searchEmailsApi(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = (req as any).user;
    if (!user) throw AppError.unauthorized('Not authenticated');

    const schema = z.object({
      q: z.string().optional(),
      status: z.string().optional(),
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
    });

    const query = schema.safeParse(req.query);
    if (!query.success) {
      throw AppError.badRequest('Invalid search parameters');
    }

    const result = await searchEmails({
      query: query.data.q || '',
      userId: user.id,
      status: query.data.status,
      page: query.data.page,
      pageSize: query.data.pageSize,
    });

    // Match the PaginatedResponse format expected by frontend
    res.json({
      success: true,
      data: result.hits,
      meta: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / result.pageSize),
      },
    });
  } catch (err) {
    next(err);
  }
}
