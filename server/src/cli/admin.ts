/**
 * Operator commands run by the `chinwag` CLI on the server (never exposed over HTTP).
 *   node --env-file=../.env dist/cli/admin.js reset-password <email>     (new password read from CHINWAG_NEW_PASSWORD)
 *   node --env-file=../.env dist/cli/admin.js unlock <email>
 *   node --env-file=../.env dist/cli/admin.js list-admins
 */
import { loadEnv } from '../config/env.js';

loadEnv();
const { prisma, disconnectPrisma } = await import('../db/prisma.js');
const { hashPassword, passwordProblems } = await import('../services/passwords.js');
const { loadSettings } = await import('../services/settings.js');
const { audit } = await import('../services/audit.js');

const [cmd, email] = process.argv.slice(2);

async function main() {
  await loadSettings();
  if (cmd === 'list-admins') {
    const users = await prisma().user.findMany({ where: { roles: { some: { role: { key: { in: ['super_admin', 'admin'] } } } } }, include: { roles: { include: { role: true } } } });
    for (const u of users) console.log(`${u.email}\t${u.roles.map((r) => r.role.key).join(',')}\t${u.isActive ? 'active' : 'inactive'}${u.lockedUntil && u.lockedUntil > new Date() ? '\tLOCKED' : ''}`);
    return;
  }
  if (!email) throw new Error('Email address required');
  const user = await prisma().user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new Error(`No user with email ${email}`);
  if (cmd === 'unlock') {
    await prisma().user.update({ where: { id: user.id }, data: { lockedUntil: null, failedLoginCount: 0 } });
    await audit({ action: 'user.unlocked', actor: { type: 'system', label: 'chinwag CLI' }, source: 'system', metadata: { userId: user.id } });
    console.log(`Unlocked ${user.email}`);
    return;
  }
  if (cmd === 'reset-password') {
    const password = process.env.CHINWAG_NEW_PASSWORD ?? '';
    const problems = passwordProblems(password, 12, [user.name, user.email.split('@')[0]]);
    if (problems.length) throw new Error(problems.join('; '));
    await prisma().$transaction([
      prisma().user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), lockedUntil: null, failedLoginCount: 0, isActive: true } }),
      prisma().userSession.deleteMany({ where: { userId: user.id } }),
    ]);
    await audit({ action: 'auth.password_reset_cli', actor: { type: 'system', label: 'chinwag CLI' }, source: 'system', metadata: { userId: user.id } });
    console.log(`Password reset for ${user.email}; all of their sessions were signed out.`);
    return;
  }
  throw new Error('Usage: admin.js reset-password|unlock <email> | list-admins');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
