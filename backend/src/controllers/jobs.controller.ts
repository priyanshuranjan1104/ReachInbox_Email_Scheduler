import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import { createEmailJob, listJobs, getJobById, cancelJob } from '../services/job.service';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../middleware/errorHandler';
import {
  CreateJobSchema,
  ListJobsQuerySchema,
  JobIdParamSchema,
  NormalisedRecipient,
} from '../schemas/job.schema';

// ──────────────────────────────────────────────────────────────────────────────
// Jobs Controller — handles HTTP layer for /api/jobs
// ──────────────────────────────────────────────────────────────────────────────

// Multer for CSV upload — memory storage, 5 MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
});

export const csvUpload = upload.single('recipients');

/**
 * POST /api/jobs
 * Create a new email batch job.
 *
 * Accepts either:
 *   - JSON body with a `recipients` array
 *   - Multipart form with a CSV file upload (`recipients` field) + other fields as form data
 */
export async function createJob(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(AppError.unauthorized());

    // ── Parse CSV if file was uploaded ────────────────────────────────────
    let rawBody = req.body as Record<string, unknown>;

    if (req.file) {
      // CSV upload path — parse CSV and inject as `recipients`
      const csvText = req.file.buffer.toString('utf-8');
      let csvRecipients: NormalisedRecipient[];

      try {
        const rows = parseCsv(csvText, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        }) as Record<string, string>[];

        csvRecipients = rows.map((row) => {
          const email = row['email'] ?? row['Email'] ?? row['EMAIL'];
          if (!email) throw new Error('CSV must have an "email" column');
          return { email: email.trim(), name: row['name'] ?? row['Name'] };
        });
      } catch (err) {
        return next(
          AppError.badRequest(
            `CSV parse error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }

      rawBody = { ...rawBody, recipients: csvRecipients };
    }

    // ── Validate ──────────────────────────────────────────────────────────
    const parsed = CreateJobSchema.safeParse(rawBody);
    if (!parsed.success) {
      return next(AppError.badRequest('Validation failed', parsed.error.issues));
    }

    // ── Create job ────────────────────────────────────────────────────────
    const result = await createEmailJob(user.id, parsed.data);

    logger.info({ jobId: result.jobId, userId: user.id }, 'Job created via API');

    res.status(201).json({
      success: true,
      data: {
        jobId: result.jobId,
        totalRecipients: result.totalRecipients,
        scheduledAt: result.scheduledAt,
        estimatedCompletionAt: result.estimatedCompletionAt,
        message: `Email job created. ${result.totalRecipients} emails scheduled.`,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/jobs
 * List all jobs for the authenticated user (paginated).
 */
export async function getJobs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(AppError.unauthorized());

    const query = ListJobsQuerySchema.safeParse(req.query);
    if (!query.success) {
      return next(AppError.badRequest('Invalid query parameters', query.error.issues));
    }

    const { jobs, total } = await listJobs({
      userId: user.id,
      page: query.data.page,
      pageSize: query.data.pageSize,
      status: query.data.status,
    });

    res.json({
      success: true,
      data: {
        jobs,
        pagination: {
          total,
          page: query.data.page,
          pageSize: query.data.pageSize,
          totalPages: Math.ceil(total / query.data.pageSize),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/jobs/:id
 * Get job details with individual email statuses.
 */
export async function getJob(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(AppError.unauthorized());

    const params = JobIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return next(AppError.badRequest('Invalid job ID'));
    }

    const job = await getJobById(params.data.id, user.id);
    res.json({ success: true, data: { job } });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/jobs/:id
 * Cancel a PENDING or RUNNING job.
 */
export async function deleteJob(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(AppError.unauthorized());

    const params = JobIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return next(AppError.badRequest('Invalid job ID'));
    }

    await cancelJob(params.data.id, user.id);
    res.json({
      success: true,
      data: { message: 'Job cancelled successfully' },
    });
  } catch (err) {
    next(err);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/jobs/simulate — Phase 5: 1000+ Job Simulation
// ──────────────────────────────────────────────────────────────────────────────

export async function simulateJobs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(AppError.unauthorized());

    // Generate 1000 dummy recipients
    const recipients = Array.from({ length: 1000 }).map((_, i) => ({
      email: `simulate-user-${i}@example.com`,
      name: `Simulated User ${i}`
    }));

    const input = {
      subject: 'Load Test Simulation',
      body: 'This is a load test. Hello {{name}}!',
      senderEmail: 'loadtest@example.com',
      senderName: 'Load Tester',
      scheduledAt: new Date(Date.now() + 60_000), // Start in 1 minute
      delayBetweenEmailsMs: 50, // 50ms delay for fast simulation
      hourlyLimit: 500, // Limit to 500 per hour so it triggers rate limiting at the halfway mark
      recipients,
    };

    const result = await createEmailJob(user.id, input);

    res.status(201).json({
      success: true,
      data: result,
      message: '1000 simulated emails enqueued successfully',
    });
  } catch (err) {
    next(err);
  }
}
