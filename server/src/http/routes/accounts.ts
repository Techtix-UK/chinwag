import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { notFound } from '../../lib/errors.js';
import * as svc from '../../services/accounts.js';
import { sessionResources } from '../../services/health.js';
import { assertCan } from '../../services/permissions.js';
import { authDirFor, clientIdFor, sessionManager } from '../../whatsapp/manager.js';
import { route } from '../route.js';

const accountParams = z.object({ accountId: z.string().min(1).max(40) });

export function accountRoutes(r: Router) {
  route(r, {
    method: 'get', path: '/accounts', summary: 'List WhatsApp accounts', tags: ['Accounts'], capability: 'accounts:read',
    handler: async ({ principal }) => svc.listAccounts(principal),
  });

  route(r, {
    method: 'post', path: '/accounts', summary: 'Add a WhatsApp account (starts QR pairing)', tags: ['Accounts'], capability: 'accounts:manage', status: 201,
    body: z.object({ display_name: z.string().min(1).max(128), connect: z.boolean().default(true) }),
    handler: async ({ principal, body }) => svc.withLive(await svc.createAccount(principal, body.display_name, body.connect)),
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId', summary: 'Get a WhatsApp account', tags: ['Accounts'], params: accountParams,
    handler: async ({ principal, params }) => svc.withLive(await svc.getAccount(principal, params.accountId)),
  });

  route(r, {
    method: 'patch', path: '/accounts/:accountId', summary: 'Rename a WhatsApp account', tags: ['Accounts'], params: accountParams,
    body: z.object({ display_name: z.string().min(1).max(128) }),
    handler: async ({ principal, params, body }) => svc.withLive(await svc.renameAccount(principal, params.accountId, body.display_name)),
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/status', summary: 'Get connection status', tags: ['Accounts'], params: accountParams,
    handler: async ({ principal, params }) => svc.accountStatus(principal, params.accountId),
  });

  for (const action of ['connect', 'disconnect', 'restart', 'logout', 'reauthenticate'] as const) {
    route(r, {
      method: 'post', path: `/accounts/:accountId/${action}`, summary: `${action[0].toUpperCase()}${action.slice(1)} the WhatsApp session`, tags: ['Accounts'], params: accountParams,
      handler: async ({ principal, params }) => svc.accountAction(principal, params.accountId, action),
    });
  }

  route(r, {
    method: 'delete', path: '/accounts/:accountId', summary: 'Remove a WhatsApp account and all of its local data', tags: ['Accounts'], params: accountParams,
    handler: async ({ principal, params }) => {
      await svc.removeAccount(principal, params.accountId);
      return undefined;
    },
  });

  // QR codes are never exposed to API keys or integrations — dashboard managers only.
  route(r, {
    method: 'get', path: '/accounts/:accountId/qr', summary: 'Current pairing QR code', tags: ['Accounts'], auth: 'session', internal: true, params: accountParams,
    handler: async ({ principal, params, res }) => {
      assertCan(principal, 'accounts:manage', params.accountId);
      res.setHeader('Cache-Control', 'no-store');
      const qr = sessionManager().qr(params.accountId);
      return qr ? { data_url: qr.dataUrl, updated_at: qr.updatedAt } : { data_url: null };
    },
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/diagnostics', summary: 'Connection diagnostics and resource usage', tags: ['Accounts'], auth: 'session', internal: true, params: accountParams,
    handler: async ({ principal, params }) => {
      assertCan(principal, 'accounts:manage', params.accountId);
      const account = await prisma().whatsappAccount.findUnique({ where: { id: params.accountId }, include: { session: true } });
      if (!account) throw notFound('WhatsApp account');
      const [chats, messages, contacts, media, resources, events] = await Promise.all([
        prisma().chat.count({ where: { accountId: account.id } }),
        prisma().message.count({ where: { accountId: account.id } }),
        prisma().contact.count({ where: { accountId: account.id } }),
        prisma().messageAttachment.aggregate({ where: { accountId: account.id, state: 'STORED' }, _sum: { sizeBytes: true }, _count: true }),
        sessionResources(),
        prisma().systemEvent.findMany({ where: { accountId: account.id }, orderBy: { timestamp: 'desc' }, take: 20 }),
      ]);
      const snap = sessionManager().snapshot(account.id);
      return {
        account: svc.withLive(account),
        session: {
          client_id: clientIdFor(account.id),
          auth_directory: authDirFor(account.id),
          wweb_version: account.session?.wwebVersion ?? null,
          last_qr_at: account.session?.lastQrAt ?? null,
          last_ready_at: account.session?.lastReadyAt ?? null,
          last_error: account.session?.lastError ?? null,
          reconnect_attempts: snap?.retries ?? account.session?.reconnectAttempts ?? 0,
          started_at: snap?.startedAt ?? null,
          loading_percent: snap?.loadingPercent ?? null,
        },
        resources: resources[account.id] ?? { pid: null, processes: 0, memory_mb: 0, cpu_percent: 0 },
        data: { chats, messages, contacts, media_files: media._count, media_bytes: media._sum.sizeBytes ?? 0 },
        events: events.map((e) => ({ timestamp: e.timestamp, level: e.level, component: e.component, message: e.message })),
      };
    },
  });
}
