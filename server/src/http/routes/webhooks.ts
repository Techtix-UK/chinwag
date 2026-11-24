import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { notFound, validationError } from '../../lib/errors.js';
import { audit } from '../../services/audit.js';
import { WEBHOOK_EVENTS } from '../../services/events.js';
import { createWebhook, invalidateWebhookCache, redeliver, rotateSecret, serializeWebhook, testWebhook, validateDestination } from '../../services/webhooks.js';
import { page, pagination, route } from '../route.js';

const idParam = z.object({ id: z.string().min(1).max(40) });
const fields = {
  name: z.string().min(1).max(128),
  url: z.url().max(1024),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  account_ids: z.array(z.string().max(40)).default([]),
  all_accounts: z.boolean().default(true),
  enabled: z.boolean().default(true),
};

export function webhookRoutes(r: Router) {
  const opts = { tags: ['Webhooks'], auth: 'session' as const, capability: 'webhooks:manage' as const, internal: true };

  route(r, { ...opts, method: 'get', path: '/webhooks/events', summary: 'Supported webhook events', handler: async () => WEBHOOK_EVENTS });

  route(r, {
    ...opts, method: 'get', path: '/webhooks', summary: 'List webhooks',
    handler: async () => {
      const hooks = await prisma().webhook.findMany({ orderBy: { createdAt: 'desc' } });
      const stats = await prisma().webhookDelivery.groupBy({ by: ['webhookId', 'status'], _count: true, where: { createdAt: { gt: new Date(Date.now() - 7 * 86400_000) } } });
      return hooks.map((h) => ({ ...serializeWebhook(h), last_7_days: Object.fromEntries(stats.filter((s) => s.webhookId === h.id).map((s) => [s.status.toLowerCase(), s._count])) }));
    },
  });

  route(r, {
    ...opts, method: 'post', path: '/webhooks', summary: 'Create a webhook (signing secret shown once)', status: 201,
    body: z.object(fields),
    handler: async ({ principal, body }) => {
      if (!body.all_accounts && !body.account_ids.length) throw validationError('Select at least one account or all accounts');
      const { webhook, secret } = await createWebhook({ name: body.name, url: body.url, events: body.events, accountIds: body.account_ids, allAccounts: body.all_accounts, enabled: body.enabled, createdById: principal.id });
      await audit({ action: 'webhook.created', actor: principal, metadata: { webhookId: webhook.id, events: body.events } });
      return { ...serializeWebhook(webhook), signing_secret: secret };
    },
  });

  route(r, {
    ...opts, method: 'patch', path: '/webhooks/:id', summary: 'Update a webhook', params: idParam,
    body: z.object(fields).partial(),
    handler: async ({ principal, params, body }) => {
      if (body.url) await validateDestination(body.url);
      const w = await prisma().webhook.update({
        where: { id: params.id },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.url ? { url: body.url } : {}),
          ...(body.events ? { events: body.events } : {}),
          ...(body.account_ids ? { accountIds: body.account_ids } : {}),
          ...(body.all_accounts !== undefined ? { allAccounts: body.all_accounts } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        },
      });
      invalidateWebhookCache();
      await audit({ action: 'webhook.updated', actor: principal, metadata: { webhookId: w.id } });
      return serializeWebhook(w);
    },
  });

  route(r, {
    ...opts, method: 'post', path: '/webhooks/:id/rotate-secret', summary: 'Rotate the signing secret', params: idParam,
    handler: async ({ principal, params }) => {
      const secret = await rotateSecret(params.id);
      await audit({ action: 'webhook.secret_rotated', actor: principal, metadata: { webhookId: params.id } });
      return { signing_secret: secret };
    },
  });

  route(r, {
    ...opts, method: 'delete', path: '/webhooks/:id', summary: 'Delete a webhook', params: idParam,
    handler: async ({ principal, params }) => {
      await prisma().webhook.delete({ where: { id: params.id } });
      invalidateWebhookCache();
      await audit({ action: 'webhook.deleted', actor: principal, metadata: { webhookId: params.id } });
      return undefined;
    },
  });

  route(r, {
    ...opts, method: 'post', path: '/webhooks/:id/test', summary: 'Send a signed test event', params: idParam,
    handler: async ({ params }) => testWebhook(params.id),
  });

  route(r, {
    ...opts, method: 'get', path: '/webhooks/:id/deliveries', summary: 'Delivery history', params: idParam, query: z.object(pagination),
    handler: async ({ params, query }) => {
      const where = { webhookId: params.id };
      const [rows, total] = await Promise.all([prisma().webhookDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, take: query.limit, skip: query.offset }), prisma().webhookDelivery.count({ where })]);
      return page(rows.map((d) => ({ id: d.id, event: d.event, event_id: d.eventId, account_id: d.accountId, status: d.status.toLowerCase(), attempts: d.attempts, next_attempt_at: d.nextAttemptAt, response_status: d.responseStatus, response_body: d.responseBody, error: d.errorDetail, duration_ms: d.durationMs, delivered_at: d.deliveredAt, created_at: d.createdAt })), total, query.limit, query.offset);
    },
  });

  route(r, {
    ...opts, method: 'post', path: '/webhooks/deliveries/:id/redeliver', summary: 'Redeliver a webhook event', params: idParam,
    handler: async ({ principal, params }) => {
      const d = await prisma().webhookDelivery.findUnique({ where: { id: params.id } });
      if (!d) throw notFound('Delivery');
      await redeliver(params.id);
      await audit({ action: 'webhook.redelivered', actor: principal, metadata: { deliveryId: params.id } });
      return { ok: true };
    },
  });
}
