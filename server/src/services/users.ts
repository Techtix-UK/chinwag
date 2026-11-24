import { prisma } from '../db/prisma.js';
import type { AccountAccessLevel } from '../generated/prisma/client.js';
import { conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { audit } from './audit.js';
import { revokeUserSessions } from './auth.js';
import { hashPassword, passwordProblems } from './passwords.js';
import { DEFAULT_ROLES, can, levelRank, type Principal } from './permissions.js';
import { settings } from './settings.js';

export async function ensureRoles() {
  const allPerms = new Set(DEFAULT_ROLES.flatMap((r) => r.permissions));
  for (const key of allPerms) await prisma().permission.upsert({ where: { key }, create: { key }, update: {} });
  const perms = await prisma().permission.findMany();
  const byKey = new Map(perms.map((p) => [p.key, p.id]));
  for (const r of DEFAULT_ROLES) {
    const role = await prisma().role.upsert({ where: { key: r.key }, create: { key: r.key, name: r.name, description: r.description, isSystem: true }, update: { name: r.name, description: r.description, isSystem: true } });
    await prisma().rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma().rolePermission.createMany({ data: r.permissions.map((k) => ({ roleId: role.id, permissionId: byKey.get(k)! })), skipDuplicates: true });
  }
}

export function serializeUser(u: any) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    timezone: u.timezone,
    is_active: u.isActive,
    locked_until: u.lockedUntil?.toISOString?.() ?? null,
    last_login_at: u.lastLoginAt?.toISOString?.() ?? null,
    created_at: u.createdAt?.toISOString?.() ?? null,
    roles: (u.roles ?? []).map((r: any) => r.role?.key ?? r),
    account_permissions: (u.accountPermissions ?? []).map((a: any) => ({ account_id: a.accountId, level: a.level.toLowerCase() })),
  };
}

const include = { roles: { include: { role: true } }, accountPermissions: true } as const;

export async function listUsers() {
  return prisma().user.findMany({ include, orderBy: { createdAt: 'asc' } });
}

/** Enforce that admins cannot escalate beyond their own authority. */
function assertCanAssign(actor: Principal, roleKeys: string[], access: { accountId: string; level: AccountAccessLevel }[]) {
  if (!can(actor, 'users:manage')) throw forbidden();
  if (!actor.isSuperAdmin) {
    if (roleKeys.includes('super_admin')) throw forbidden('Only super administrators can grant the Super Administrator role');
    for (const a of access) {
      const own = actor.accountAccess === 'all' ? 'MANAGE' : actor.accountAccess.get(a.accountId);
      if (!own || levelRank(own) < levelRank(a.level) || levelRank(own) < levelRank('MANAGE')) throw forbidden('You can only grant access to accounts you manage, up to your own level');
    }
  }
}

export async function createUser(actor: Principal, input: { email: string; name: string; password: string; roles: string[]; access: { accountId: string; level: AccountAccessLevel }[]; timezone?: string | null }) {
  assertCanAssign(actor, input.roles, input.access);
  const email = input.email.trim().toLowerCase();
  const problems = passwordProblems(input.password, settings().passwordMinLength, [input.name, email.split('@')[0]]);
  if (problems.length) throw validationError(problems[0], { problems });
  if (await prisma().user.findUnique({ where: { email } })) throw conflict('A user with this email already exists');
  const roles = await prisma().role.findMany({ where: { key: { in: input.roles } } });
  if (roles.length !== input.roles.length) throw validationError('Unknown role');
  const user = await prisma().user.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      timezone: input.timezone ?? null,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
      accountPermissions: { create: input.access.map((a) => ({ accountId: a.accountId, level: a.level })) },
    },
    include,
  });
  await audit({ action: 'user.created', actor, metadata: { userId: user.id, email, roles: input.roles } });
  return user;
}

export async function updateUser(actor: Principal, id: string, patch: { name?: string; isActive?: boolean; roles?: string[]; access?: { accountId: string; level: AccountAccessLevel }[]; timezone?: string | null; password?: string }) {
  const target = await prisma().user.findUnique({ where: { id }, include });
  if (!target) throw notFound('User');
  const targetIsSuper = target.roles.some((r) => r.role.key === 'super_admin');
  if (targetIsSuper && !actor.isSuperAdmin) throw forbidden('Only super administrators can modify a super administrator');
  assertCanAssign(actor, patch.roles ?? [], patch.access ?? []);
  if (id === actor.id && (patch.isActive === false || (patch.roles && !patch.roles.includes('super_admin') && targetIsSuper))) {
    throw forbidden('You cannot deactivate or demote yourself');
  }
  if (targetIsSuper && (patch.isActive === false || (patch.roles && !patch.roles.includes('super_admin')))) {
    const supers = await prisma().userRole.count({ where: { role: { key: 'super_admin' }, user: { isActive: true } } });
    if (supers <= 1) throw conflict('At least one active super administrator is required');
  }
  await prisma().$transaction(async (tx) => {
    let passwordHash: string | undefined;
    if (patch.password) {
      const problems = passwordProblems(patch.password, settings().passwordMinLength, [target.name, target.email.split('@')[0]]);
      if (problems.length) throw validationError(problems[0], { problems });
      passwordHash = await hashPassword(patch.password);
    }
    await tx.user.update({
      where: { id },
      data: {
        ...(patch.name ? { name: patch.name.trim() } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(passwordHash ? { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } : {}),
      },
    });
    if (patch.roles) {
      const roles = await tx.role.findMany({ where: { key: { in: patch.roles } } });
      if (roles.length !== patch.roles.length) throw validationError('Unknown role');
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) });
    }
    if (patch.access) {
      await tx.userAccountPermission.deleteMany({ where: { userId: id } });
      if (patch.access.length) await tx.userAccountPermission.createMany({ data: patch.access.map((a) => ({ userId: id, accountId: a.accountId, level: a.level })) });
    }
  });
  if (patch.isActive === false || patch.password) await revokeUserSessions(id);
  await audit({ action: 'user.updated', actor, metadata: { userId: id, fields: Object.keys(patch), roles: patch.roles } });
  if (patch.roles || patch.access) await audit({ action: 'permissions.changed', actor, metadata: { userId: id, roles: patch.roles, access: patch.access?.map((a) => `${a.accountId}:${a.level}`) } });
  return prisma().user.findUniqueOrThrow({ where: { id }, include });
}

export async function deleteUser(actor: Principal, id: string) {
  if (id === actor.id) throw forbidden('You cannot delete yourself');
  const target = await prisma().user.findUnique({ where: { id }, include });
  if (!target) throw notFound('User');
  if (target.roles.some((r) => r.role.key === 'super_admin')) {
    if (!actor.isSuperAdmin) throw forbidden();
    const supers = await prisma().userRole.count({ where: { role: { key: 'super_admin' } } });
    if (supers <= 1) throw conflict('At least one super administrator is required');
  }
  if (!can(actor, 'users:manage')) throw forbidden();
  await prisma().user.delete({ where: { id } });
  await audit({ action: 'user.deleted', actor, metadata: { userId: id, email: target.email } });
}
