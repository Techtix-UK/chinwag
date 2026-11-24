import type { Request, Response, NextFunction, Express } from 'express';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { settings } from '../../services/settings.js';
import { randomToken } from '../../lib/crypto.js';

export function securityHeaders(app: Express) {
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:', 'https://*.whatsapp.net', 'https://*.fbcdn.net'],
          'media-src': ["'self'", 'blob:'],
          'connect-src': ["'self'", ...(env().isProduction ? [] : ['ws:', 'http://localhost:*'])],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'", 'https:', ...(env().isProduction ? [] : ['http:'])],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'upgrade-insecure-requests': env().secureCookies ? [] : null,
        },
      },
      strictTransportSecurity: env().secureCookies ? { maxAge: 31536000, includeSubDomains: true } : false,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'same-origin' },
    }),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.requestId = randomToken(9);
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
}

/** Redirect plain HTTP to HTTPS when the public URL is HTTPS (behind a TLS-terminating proxy). */
export function httpsEnforcement(req: Request, res: Response, next: NextFunction) {
  if (!env().secureCookies || req.secure || req.path === '/api/v1/health') return next();
  if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(301, env().baseUrl.origin + req.originalUrl);
  res.status(403).json({ error: { code: 'https_required', message: 'HTTPS is required' } });
}

export const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: () => settings().apiRateLimitPerMinute,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req.principal ? `${req.principal.type}:${req.principal.id}` : ipKeyGenerator(req.ip ?? '')),
  skip: (req) => req.principal?.type === 'user' && req.method === 'GET',
  handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests — slow down' } }),
});

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ''),
  handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message: 'Too many login attempts — try again later' } }),
});

export const setupRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ''),
  handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message: 'Too many attempts' } }),
});
