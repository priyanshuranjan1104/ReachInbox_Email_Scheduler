import { Request, Response, NextFunction } from 'express';
import pino from 'pino';

// ──────────────────────────────────────────────────────────────────────────────
// Structured logger (pino)
// Pretty-print in dev, JSON in production
// ──────────────────────────────────────────────────────────────────────────────
export const logger = pino({
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

// ──────────────────────────────────────────────────────────────────────────────
// AppError — structured error class with HTTP status code
// ──────────────────────────────────────────────────────────────────────────────
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, message, 'BAD_REQUEST', details);
  }

  static unauthorized(message = 'Unauthorized') {
    return new AppError(401, message, 'UNAUTHORIZED');
  }

  static forbidden(message = 'Forbidden') {
    return new AppError(403, message, 'FORBIDDEN');
  }

  static notFound(message = 'Not found') {
    return new AppError(404, message, 'NOT_FOUND');
  }

  static conflict(message: string) {
    return new AppError(409, message, 'CONFLICT');
  }

  static internal(message = 'Internal server error') {
    return new AppError(500, message, 'INTERNAL_ERROR');
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Global error handler middleware
// Must be last middleware registered (4-param signature)
// ──────────────────────────────────────────────────────────────────────────────
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(process.env['NODE_ENV'] !== 'production' && err.details
          ? { details: err.details }
          : {}),
      },
    });
    return;
  }

  // Zod validation error (from validate middleware)
  if (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'ZodError'
  ) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: (err as unknown as { issues: unknown[] }).issues,
      },
    });
    return;
  }

  // Prisma known request error
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (err as { code: string }).code.startsWith('P')
  ) {
    logger.error({ err }, 'Prisma error');
    res.status(500).json({
      success: false,
      error: { code: 'DATABASE_ERROR', message: 'A database error occurred' },
    });
    return;
  }

  // Unknown error
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
