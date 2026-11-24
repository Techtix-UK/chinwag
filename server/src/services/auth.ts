import { prisma } from '../db/prisma.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { settings } from './settings.js';
import { audit } from './audit.js';
import { dummyVerify, verifyPassword } from './passwords.js';
import { loadUserPrincipal } from './principals.js';
import type { Principal } from './permissions.js';

export const SESSION_COOKIE = 'chinwag_session';

export type LoginResult =
  | { ok: true; token: string; csrfToken: string; expiresAt: Date; userId: string }
  | { ok: false; reason: 'invalid' | 'locked' | 'inactive'; lockedUntil?: Date };

export async function login(email: string, password: string, ctx: { ip?: string; userAgent?: string }): Promise<LoginResult> {
  const s = settings();
  const user = await prisma().user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    await dummyVerify(password);
    await audit({ action: 'auth.login_failed', actor: { type: 'anonymous', label: email.slice(0, 120) }, source: 'dashboard', result: 'failure', ip: ctx.ip, metadata: { reason: 'unknown_user' } });
    return { ok: false, reason: 'invalid' };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await dummyVerify(password);
    await audit({ action: 'auth.login_failed', actor: { type: 'user', id: user.id, label: user.email }, source: 'dashboard', result: 'denied', ip: ctx.ip, metadata: { reason: 'locked' } });
    return { ok: false, reason: 'locked', lockedUntil: user.lockedUntil };
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= s.loginMaxAttempts ? new Date(Date.now() + s.loginLockoutMinutes * 60_000) : null;
    await prisma().user.update({ where: { id: user.id }, data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock } });
    await audit({ action: 'auth.login_failed', actor: { type: 'user', id: user.id, label: user.email }, source: 'dashboard', result: 'failure', ip: ctx.ip, metadata: { reason: 'bad_password', locked: !!lock } });
    return lock ? { ok: false, reason: 'locked', lockedUntil: lock } : { ok: false, reason: 'invalid' };
  }
  if (!user.isActive) {
    await audit({ action: 'auth.login_failed', actor: { type: 'user', id: user.id, label: user.email }, source: 'dashboard', result: 'denied', ip: ctx.ip, metadata: { reason: 'inactive' } });
    return { ok: false, reason: 'inactive' };
  }
  const token = randomToken(32);
  const csrfToken = randomToken(32).slice(0, 43);
  const expiresAt = new Date(Date.now() + s.sessionExpiryHours * 3600_000);
  await prisma().$transaction([
    prisma().user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } }),
    prisma().userSession.create({
      data: { userId: user.id, tokenHash: sha256(token), csrfToken, ipAddress: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 500) ?? null, expiresAt },
    }),
  ]);
  await audit({ action: 'auth.login', actor: { type: 'user', id: user.id, label: user.email }, source: 'dashboard', ip: ctx.ip });
  return { ok: true, token, csrfToken, expiresAt, userId: user.id };
}

/** Resolve a session cookie into a principal; enforces absolute and idle expiry. */
export async function resolveSession(token: string | undefined): Promise<Principal | null> {
  if (!token || token.length > 128) return null;
  const session = await prisma().userSession.findUnique({ where: { tokenHash: sha256(token) } });
  if (!session) return null;
  const now = Date.now();
  const idleMs = settings().sessionIdleMinutes * 60_000;
  if (session.expiresAt.getTime() < now || session.lastSeenAt.getTime() + idleMs < now) {
    await prisma().userSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const principal = await loadUserPrincipal(session.userId);
  if (!principal) return null;
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma().userSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  principal.sessionId = session.id;
  principal.csrfToken = session.csrfToken;
  return principal;
}

export async function logout(sessionId: string) {
  await prisma().userSession.deleteMany({ where: { id: sessionId } });
}

export async function revokeUserSessions(userId: string, exceptSessionId?: string) {
  await prisma().userSession.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
}
