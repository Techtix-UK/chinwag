import type { Request, Response, NextFunction } from 'express';
import { parseCookie } from 'cookie';
import { env } from '../../config/env.js';
import { safeEqual } from '../../lib/crypto.js';
import { AppError, forbidden } from '../../lib/errors.js';
import { authenticateApiKey } from '../../services/apiKeys.js';
import { resolveSession, SESSION_COOKIE } from '../../services/auth.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function sessionToken(req: Request): string | undefined {
  const cookies = parseCookie(req.headers.cookie ?? '');
  return cookies[SESSION_COOKIE];
}

/**
 * Resolves the caller: Bearer API key (integrations) or session cookie (dashboard).
 * Cookie-authenticated unsafe requests must carry a matching X-CSRF-Token and a same-origin Origin header.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const authz = req.headers.authorization;
    if (authz) {
      const m = /^Bearer\s+(\S+)$/i.exec(authz);
      if (!m) throw new AppError(401, 'unauthorized', 'Malformed Authorization header');
      const p = await authenticateApiKey(m[1], req.ip);
      if (!p) throw new AppError(401, 'invalid_api_key', 'Invalid, expired or revoked API key');
      req.principal = p;
      return next();
    }
    const token = sessionToken(req);
    if (token) {
      const p = await resolveSession(token);
      if (p) {
        if (!SAFE.has(req.method)) {
          const header = req.get('x-csrf-token') ?? '';
          if (!p.csrfToken || !header || !safeEqual(header, p.csrfToken.trim())) throw forbidden('CSRF token missing or invalid');
          const origin = req.get('origin');
          if (origin && origin !== env().baseUrl.origin && !(env().NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) {
            throw forbidden('Cross-origin request rejected');
          }
        }
        p.ip = req.ip;
        req.principal = p;
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function sessionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: env().secureCookies,
    sameSite: 'lax' as const,
    path: '/',
    ...(expires ? { expires } : {}),
  };
}
