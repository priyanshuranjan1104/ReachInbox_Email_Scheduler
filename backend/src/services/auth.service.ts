import passport from 'passport';
import {
  Strategy as GoogleStrategy,
  Profile,
  VerifyCallback,
} from 'passport-google-oauth20';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../middleware/errorHandler';

// ──────────────────────────────────────────────────────────────────────────────
// Passport.js — Google OAuth 2.0 Strategy
// ──────────────────────────────────────────────────────────────────────────────

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
};

declare global {
  // Augment Express.User to match our session shape
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User extends SessionUser {}
  }
}

/**
 * Configure Passport strategies.
 * Call once from src/index.ts before mounting routes.
 */
export function configurePassport(): void {
  // ── Google Strategy ──────────────────────────────────────────────────────
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        callbackURL: env.GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email'],
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: VerifyCallback,
      ) => {
        try {
          const email = profile.emails?.[0]?.value;
          const avatar = profile.photos?.[0]?.value ?? null;
          const name = profile.displayName ?? 'Unknown';

          if (!email) {
            return done(new Error('Google profile has no email address'));
          }

          // Upsert the user — creates on first login, updates on subsequent logins
          const user = await prisma.user.upsert({
            where: { googleId: profile.id },
            update: { name, avatar, email },
            create: {
              googleId: profile.id,
              email,
              name,
              avatar,
            },
          });

          const sessionUser: SessionUser = {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar,
          };

          logger.info({ userId: user.id, email: user.email }, 'Google OAuth login');
          return done(null, sessionUser);
        } catch (err) {
          logger.error({ err }, 'Google OAuth strategy error');
          return done(err instanceof Error ? err : new Error(String(err)));
        }
      },
    ),
  );

  // ── Serialize / Deserialize ───────────────────────────────────────────────
  // Only the user ID is stored in the session cookie.
  // The full user object is loaded from the DB on each request.

  passport.serializeUser((user: Express.User, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, email: true, name: true, avatar: true },
      });
      if (!user) return done(null, false);
      done(null, user as SessionUser);
    } catch (err) {
      done(err);
    }
  });
}
