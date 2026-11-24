import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { AppError, validationError } from '../../lib/errors.js';
import { login, logout, revokeUserSessions, SESSION_COOKIE } from '../../services/auth.js';
import { audit } from '../../services/audit.js';
import { hashPassword, passwordProblems, verifyPassword } from '../../services/passwords.js';
import { ALL_CAPABILITIES, can } from '../../services/permissions.js';
import { settings } from '../../services/settings.js';
import { isValidTimezone } from '../../services/scheduler.js';
import { loginRateLimit } from '../middleware/security.js';
import { sessionCookieOptions } from '../middleware/auth.js';
import { route } from '../route.js';

export function authRoutes(r: Router) {
  route(r, {
    method: 'post', path: '/auth/login', summary: 'Log in to the dashboard', tags: ['Auth'], auth: 'public', internal: true,
    middleware: [loginRateLimit],
    body: z.object({ email: z.string().email().max(191), password: z.string().min(1).max(256) }),
    handler: async ({ req, res, body }) => {
      const result = await login(body.email, body.password, { ip: req.ip, userAgent: req.get('user-agent') });
      if (!result.ok) {
        if (result.reason === 'locked') throw new AppError(423, 'account_locked', `Too many failed attempts. Try again after ${result.lockedUntil?.toISOString()}`);
        throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
      }
      res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
      return { csrf_token: result.csrfToken, expires_at: result.expiresAt.toISOString() };
    },
  });

  route(r, {
    method: 'post', path: '/auth/logout', summary: 'Log out', tags: ['Auth'], auth: 'session-any', internal: true,
    handler: async ({ res, principal }) => {
      if (principal.sessionId) await logout(principal.sessionId);
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
      await audit({ action: 'auth.logout', actor: principal });
      return { ok: true };
    },
  });

  route(r, {
    method: 'get', path: '/auth/me', summary: 'Current user', tags: ['Auth'], auth: 'session-any', internal: true,
    handler: async ({ principal }) => {
      const user = await prisma().user.findUniqueOrThrow({ where: { id: principal.id } });
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        timezone: user.timezone ?? settings().defaultTimezone,
        roles: principal.roles,
        is_super_admin: principal.isSuperAdmin,
        dashboard_access: can(principal, 'dashboard:access'),
        capabilities: ALL_CAPABILITIES.filter((c) => can(principal, c)),
        account_access: principal.accountAccess === 'all' ? 'all' : Object.fromEntries([...principal.accountAccess.entries()].map(([k, v]) => [k, v.toLowerCase()])),
        csrf_token: principal.csrfToken?.trim(),
        app: { name: settings().appName, logo_url: settings().logoUrl, default_timezone: settings().defaultTimezone },
      };
    },
  });

  route(r, {
    method: 'patch', path: '/auth/me', summary: 'Update profile', tags: ['Auth'], auth: 'session-any', internal: true,
    body: z.object({ name: z.string().min(1).max(191).optional(), timezone: z.string().max(64).nullable().optional() }),
    handler: async ({ principal, body }) => {
      if (body.timezone && !isValidTimezone(body.timezone)) throw validationError('Unknown timezone');
      await prisma().user.update({ where: { id: principal.id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.timezone !== undefined ? { timezone: body.timezone } : {}) } });
      return { ok: true };
    },
  });

  route(r, {
    method: 'post', path: '/auth/password', summary: 'Change password', tags: ['Auth'], auth: 'session-any', internal: true,
    middleware: [loginRateLimit],
    body: z.object({ current_password: z.string().min(1).max(256), new_password: z.string().min(1).max(256) }),
    handler: async ({ principal, body }) => {
      const user = await prisma().user.findUniqueOrThrow({ where: { id: principal.id } });
      if (!(await verifyPassword(user.passwordHash, body.current_password))) throw new AppError(401, 'invalid_credentials', 'Current password is incorrect');
      const problems = passwordProblems(body.new_password, settings().passwordMinLength, [user.name, user.email.split('@')[0]]);
      if (problems.length) throw validationError(problems[0], { problems });
      await prisma().user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.new_password), passwordChangedAt: new Date() } });
      await revokeUserSessions(user.id, principal.sessionId);
      await audit({ action: 'auth.password_changed', actor: principal });
      return { ok: true };
    },
  });

  route(r, {
    method: 'get', path: '/auth/sessions', summary: 'List my active sessions', tags: ['Auth'], auth: 'session-any', internal: true,
    handler: async ({ principal }) => {
      const rows = await prisma().userSession.findMany({ where: { userId: principal.id }, orderBy: { lastSeenAt: 'desc' } });
      return rows.map((s) => ({ id: s.id, current: s.id === principal.sessionId, ip_address: s.ipAddress, user_agent: s.userAgent, created_at: s.createdAt, last_seen_at: s.lastSeenAt, expires_at: s.expiresAt }));
    },
  });

  route(r, {
    method: 'delete', path: '/auth/sessions/:id', summary: 'Revoke one of my sessions', tags: ['Auth'], auth: 'session-any', internal: true,
    params: z.object({ id: z.string().max(40) }),
    handler: async ({ principal, params }) => {
      await prisma().userSession.deleteMany({ where: { id: params.id, userId: principal.id } });
      return undefined;
    },
  });
}
