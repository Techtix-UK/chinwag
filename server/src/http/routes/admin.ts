import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { validationError } from '../../lib/errors.js';
import { audit } from '../../services/audit.js';
import { systemStatus } from '../../services/health.js';
import { accountFilter, ALL_CAPABILITIES, DEFAULT_ROLES, SCOPE_DESCRIPTIONS } from '../../services/permissions.js';
import { settings, settingsSchema, updateSettings } from '../../services/settings.js';
import { createUser, deleteUser, listUsers, serializeUser, updateUser } from '../../services/users.js';
import { isValidTimezone } from '../../services/scheduler.js';
import { withLive } from '../../services/accounts.js';
import { serializeChat } from '../../services/serializers.js';
import { sessionManager } from '../../whatsapp/manager.js';
import { page, pagination, route } from '../route.js';

const access = z.array(z.object({ account_id: z.string().max(40), level: z.enum(['read', 'send', 'manage']) }));
const toAccess = (a: z.infer<typeof access>) => a.map((x) => ({ accountId: x.account_id, level: x.level.toUpperCase() as 'READ' | 'SEND' | 'MANAGE' }));

export function adminRoutes(r: Router) {
  // ───────────── overview ─────────────
  route(r, {
    method: 'get', path: '/overview', summary: 'Dashboard overview statistics', tags: ['Dashboard'], auth: 'session', capability: 'accounts:read', internal: true,
    handler: async ({ principal }) => {
      const f = accountFilter(principal, 'accounts:read');
      const accWhere = f ? { id: f } : {};
      const scoped = f ? { accountId: f } : {};
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const [accounts, unread, received, sent, scheduled, approvals, recentChats, activity] = await Promise.all([
        prisma().whatsappAccount.findMany({ where: accWhere, orderBy: { createdAt: 'asc' } }),
        prisma().chat.count({ where: { ...scoped, unreadCount: { gt: 0 }, isArchived: false } }),
        prisma().message.count({ where: { ...scoped, direction: 'INBOUND', timestamp: { gte: startOfDay } } }),
        prisma().message.count({ where: { ...scoped, direction: 'OUTBOUND', timestamp: { gte: startOfDay } } }),
        prisma().scheduledMessage.count({ where: { ...scoped, status: { in: ['PENDING', 'AWAITING_APPROVAL'] } } }),
        prisma().messageApproval.count({ where: { ...scoped, status: 'PENDING' } }),
        prisma().chat.findMany({ where: scoped, orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } }, take: 8 }),
        prisma().auditLog.findMany({ where: { action: { startsWith: 'account.' }, ...(f ? { accountId: f } : {}) }, orderBy: { timestamp: 'desc' }, take: 10 }),
      ]);
      const live = accounts.map(withLive);
      const status = await systemStatus(false);
      return {
        accounts: live,
        stats: {
          connected_accounts: live.filter((a) => a.status === 'connected' || a.status === 'synchronising').length,
          disconnected_accounts: live.filter((a) => a.status !== 'connected' && a.status !== 'synchronising').length,
          unread_conversations: unread,
          messages_received_today: received,
          messages_sent_today: sent,
          pending_scheduled: scheduled,
          pending_approvals: approvals,
        },
        recent_conversations: recentChats.map(serializeChat),
        recent_activity: activity.map((a) => ({ id: a.id, timestamp: a.timestamp, action: a.action, actor: a.actorLabel, account_id: a.accountId, result: a.result })),
        system: status,
      };
    },
  });

  // ───────────── users & roles ─────────────
  route(r, {
    method: 'get', path: '/roles', summary: 'Roles and permissions', tags: ['Users'], auth: 'session', capability: 'users:manage', internal: true,
    handler: async () => ({ roles: DEFAULT_ROLES, permissions: ALL_CAPABILITIES.map((c) => ({ key: c, description: SCOPE_DESCRIPTIONS[c] })) }),
  });

  route(r, {
    method: 'get', path: '/users', summary: 'List users', tags: ['Users'], auth: 'session', capability: 'users:manage', internal: true,
    handler: async () => (await listUsers()).map(serializeUser),
  });

  route(r, {
    method: 'post', path: '/users', summary: 'Create a user', tags: ['Users'], auth: 'session', capability: 'users:manage', internal: true, status: 201,
    body: z.object({ email: z.string().email().max(191), name: z.string().min(1).max(191), password: z.string().min(1).max(256), roles: z.array(z.string().max(64)).min(1), account_access: access.default([]), timezone: z.string().max(64).nullable().optional() }),
    handler: async ({ principal, body }) => {
      if (body.timezone && !isValidTimezone(body.timezone)) throw validationError('Unknown timezone');
      return serializeUser(await createUser(principal, { email: body.email, name: body.name, password: body.password, roles: body.roles, access: toAccess(body.account_access), timezone: body.timezone }));
    },
  });

  route(r, {
    method: 'patch', path: '/users/:id', summary: 'Update a user', tags: ['Users'], auth: 'session', capability: 'users:manage', internal: true, params: z.object({ id: z.string().max(40) }),
    body: z.object({ name: z.string().min(1).max(191).optional(), is_active: z.boolean().optional(), roles: z.array(z.string().max(64)).min(1).optional(), account_access: access.optional(), timezone: z.string().max(64).nullable().optional(), password: z.string().min(1).max(256).optional() }),
    handler: async ({ principal, params, body }) =>
      serializeUser(await updateUser(principal, params.id, { name: body.name, isActive: body.is_active, roles: body.roles, access: body.account_access ? toAccess(body.account_access) : undefined, timezone: body.timezone, password: body.password })),
  });

  route(r, {
    method: 'post', path: '/users/:id/unlock', summary: 'Clear a login lockout', tags: ['Users'], auth: 'session', capability: 'users:manage', internal: true, params: z.object({ id: z.string().max(40) }),
    handler: async ({ principal, params }) => {
      await prisma().user.update({ where: { id: params.id }, data: { lockedUntil: null, failedLoginCount: 0 } });
      await audit({ action: 'user.unlocked', actor: principal, metadata: { userId: params.id } });
      return { ok: true };
    },
  });

  route(r, {
    method: 'delete', path: '/users/:id', summary: 'Delete a user', tags: ['Users'], auth: 'session', capability: 'users:manage', internal: true, params: z.object({ id: z.string().max(40) }),
    handler: async ({ principal, params }) => {
      await deleteUser(principal, params.id);
      return undefined;
    },
  });

  // ───────────── audit logs ─────────────
  route(r, {
    method: 'get', path: '/audit-logs', summary: 'Search activity logs', tags: ['Activity'], auth: 'session', capability: 'audit:read', internal: true,
    query: z.object({ q: z.string().max(120).optional(), action: z.string().max(96).optional(), source: z.string().max(32).optional(), result: z.string().max(16).optional(), account_id: z.string().max(40).optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), ...pagination }),
    handler: async ({ principal, query }) => {
      const where: Prisma.AuditLogWhereInput = {};
      if (!principal.isSuperAdmin) {
        const f = accountFilter(principal, 'accounts:read');
        if (f) where.OR = [{ accountId: f }, { accountId: null, actorId: principal.id }];
      }
      if (query.action) where.action = { startsWith: query.action };
      if (query.source) where.source = query.source;
      if (query.result) where.result = query.result;
      if (query.account_id) where.accountId = query.account_id;
      if (query.q) where.AND = [{ OR: [{ action: { contains: query.q } }, { actorLabel: { contains: query.q } }, { ipAddress: { contains: query.q } }] }];
      if (query.from || query.to) where.timestamp = { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) };
      const [rows, total] = await Promise.all([prisma().auditLog.findMany({ where, orderBy: { timestamp: 'desc' }, take: query.limit, skip: query.offset }), prisma().auditLog.count({ where })]);
      return page(rows.map((a) => ({ id: a.id, timestamp: a.timestamp, action: a.action, actor: { type: a.actorType, id: a.actorId, label: a.actorLabel }, source: a.source, account_id: a.accountId, result: a.result, ip_address: a.ipAddress, metadata: a.metadata })), total, query.limit, query.offset);
    },
  });

  // ───────────── system ─────────────
  route(r, {
    method: 'get', path: '/system/status', summary: 'Detailed system status', tags: ['System'], capability: 'system:read',
    handler: async () => systemStatus(true),
  });

  route(r, {
    method: 'get', path: '/system/events', summary: 'System events', tags: ['System'], auth: 'session', capability: 'system:read', internal: true,
    query: z.object({ level: z.enum(['info', 'warn', 'error']).optional(), ...pagination }),
    handler: async ({ query }) => {
      const where = query.level ? { level: query.level } : {};
      const [rows, total] = await Promise.all([prisma().systemEvent.findMany({ where, orderBy: { timestamp: 'desc' }, take: query.limit, skip: query.offset }), prisma().systemEvent.count({ where })]);
      return page(rows, total, query.limit, query.offset);
    },
  });

  route(r, {
    method: 'post', path: '/system/sessions/:accountId/restart', summary: 'Restart one account session', tags: ['System'], auth: 'session', capability: 'accounts:manage', internal: true, params: z.object({ accountId: z.string().max(40) }),
    handler: async ({ principal, params }) => {
      await sessionManager().restart(params.accountId);
      await audit({ action: 'account.restart', actor: principal, accountId: params.accountId });
      return { ok: true };
    },
  });

  // ───────────── settings ─────────────
  route(r, {
    method: 'get', path: '/settings', summary: 'Application settings', tags: ['Settings'], auth: 'session', capability: 'settings:manage', internal: true,
    handler: async () => settings(),
  });

  route(r, {
    method: 'patch', path: '/settings', summary: 'Update application settings', tags: ['Settings'], auth: 'session', capability: 'settings:manage', internal: true,
    body: settingsSchema.omit({ setupCompleted: true }).partial(),
    handler: async ({ principal, body }) => {
      if (body.defaultTimezone && !isValidTimezone(body.defaultTimezone)) throw validationError('Unknown timezone');
      if (body.logoUrl && !/^(https:\/\/|\/)/.test(body.logoUrl)) throw validationError('Logo URL must be HTTPS or a local path');
      const s = await updateSettings(body, principal.id);
      await audit({ action: 'settings.updated', actor: principal, metadata: { fields: Object.keys(body) } });
      return s;
    },
  });

  route(r, {
    method: 'get', path: '/accounts-summary', summary: 'Accounts for selectors', tags: ['Dashboard'], auth: 'session', internal: true, query: z.object(pagination),
    handler: async ({ principal, query }) => {
      const f = accountFilter(principal, 'accounts:read');
      const rows = await prisma().whatsappAccount.findMany({ where: f ? { id: f } : {}, select: { id: true, displayName: true, phoneNumber: true, status: true }, take: query.limit });
      return page(rows.map((a) => ({ id: a.id, display_name: a.displayName, phone_number: a.phoneNumber ? '+' + a.phoneNumber : null, status: a.status.toLowerCase() })), rows.length, query.limit, 0);
    },
  });
}
