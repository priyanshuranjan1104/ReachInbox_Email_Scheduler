import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from './errorHandler';

// ──────────────────────────────────────────────────────────────────────────────
// Zod-based request validation middleware factory
// ──────────────────────────────────────────────────────────────────────────────

export type RequestPart = 'body' | 'query' | 'params';

/**
 * Returns Express middleware that validates the specified part of the request
 * against a Zod schema. On failure, passes a ZodError to the error handler.
 *
 * Usage:
 *   router.post('/jobs', validate('body', CreateJobSchema), jobsController.create);
 */
export function validate<T>(part: RequestPart, schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[part]);
      // Replace the raw input with the parsed/coerced/defaulted values
      (req as unknown as Record<string, unknown>)[part] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(AppError.badRequest('Validation failed', err.issues));
      } else {
        next(err);
      }
    }
  };
}
