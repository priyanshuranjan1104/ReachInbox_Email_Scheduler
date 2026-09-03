import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

// ──────────────────────────────────────────────────────────────────────────────
// Authentication middleware
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Ensures the request is from an authenticated user.
 * Passport.js populates req.user after successful OAuth login.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    next(AppError.unauthorized('You must be logged in to access this resource'));
    return;
  }
  next();
}

/**
 * Optionally attaches user to the request but does not block unauthenticated requests.
 * Useful for routes that work for both guests and authenticated users.
 */
export function optionalAuth(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next();
}
