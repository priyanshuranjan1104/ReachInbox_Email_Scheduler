import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────────
// Zod Validation Schemas for Email Scheduling API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A single recipient entry.
 * Can be a plain email string or an object with email + metadata.
 */
const recipientSchema = z.union([
  z.string().email('Invalid recipient email address'),
  z.object({
    email: z.string().email('Invalid recipient email address'),
    name: z.string().max(200).optional(),
  }),
]);

/**
 * POST /api/jobs — Create a new email batch job.
 */
export const CreateJobSchema = z.object({
  subject: z
    .string()
    .min(1, 'Subject is required')
    .max(998, 'Subject must be under 998 characters'),

  body: z
    .string()
    .min(1, 'Body is required')
    .max(100_000, 'Body is too large (max 100 KB)'),

  senderEmail: z
    .string()
    .email('senderEmail must be a valid email address'),

  senderName: z
    .string()
    .max(200, 'Sender name must be under 200 characters')
    .optional()
    .default('ReachInbox Mailer'),

  /**
   * Recipients as a JSON array of emails or {email, name} objects.
   * For CSV uploads the route handler pre-parses and injects this field.
   */
  recipients: z
    .array(recipientSchema)
    .min(1, 'At least one recipient is required')
    .max(10_000, 'Maximum 10,000 recipients per job'),

  /**
   * ISO-8601 string or Date — when to begin sending the first email.
   * Must be in the future (at least 10 seconds from now).
   */
  scheduledAt: z
    .string()
    .or(z.date())
    .transform((val) => new Date(val))
    .refine(
      (d) => !isNaN(d.getTime()),
      'scheduledAt must be a valid ISO-8601 date',
    )
    .refine(
      (d) => d.getTime() > Date.now() - 60_000, // allow 1 min in past for clock skew
      'scheduledAt must not be in the past',
    ),

  /**
   * Milliseconds to wait between consecutive sends within the same batch.
   * Default: 2000 ms.  Range: 0 – 3,600,000 ms (1 hour).
   */
  delayBetweenEmailsMs: z
    .number()
    .int()
    .min(0, 'delayBetweenEmailsMs must be >= 0')
    .max(3_600_000, 'delayBetweenEmailsMs must be <= 1 hour')
    .optional()
    .default(2000),

  /**
   * Maximum emails sent per hour across the entire job.
   * Default: 100.  Range: 1 – 10,000.
   */
  hourlyLimit: z
    .number()
    .int()
    .min(1, 'hourlyLimit must be >= 1')
    .max(10_000, 'hourlyLimit must be <= 10,000')
    .optional()
    .default(100),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;

/** Normalised recipient (always has .email, optionally .name) */
export type NormalisedRecipient = { email: string; name?: string };

/** Helper — normalise a raw recipient entry to { email, name? } */
export function normaliseRecipient(
  r: z.infer<typeof recipientSchema>,
): NormalisedRecipient {
  if (typeof r === 'string') return { email: r };
  return { email: r.email, name: r.name };
}

// ──────────────────────────────────────────────────────────────────────────────
// List / query schemas
// ──────────────────────────────────────────────────────────────────────────────

export const ListJobsQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status:   z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED']).optional(),
});

export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;

export const ListEmailsQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status:   z.enum(['SCHEDULED', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'RATE_LIMITED', 'RESCHEDULED', 'CANCELLED']).optional(),
  jobId:    z.string().optional(),
});

export type ListEmailsQuery = z.infer<typeof ListEmailsQuerySchema>;

export const JobIdParamSchema = z.object({
  id: z.string().min(1, 'Job ID is required'),
});

export const EmailIdParamSchema = z.object({
  id: z.string().min(1, 'Email ID is required'),
});
