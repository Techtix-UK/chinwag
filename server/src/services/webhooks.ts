import { prisma } from '../db/prisma.js';
import type { Webhook } from '../generated/prisma/client.js';
import { decryptSecret, encryptSecret, hmacSha256, randomToken, safeEqual } from '../lib/crypto.js';
import { notFound, validationError } from '../lib/errors.js';
import { errMsg, logger } from '../lib/logger.js';
import { BlockedDestinationError, safeFetch, validateUrl } from '../lib/netguard.js';
import { env } from '../config/env.js';
import { audit, systemEvent } from './audit.js';
import { bus, WEBHOOK_EVENTS, type BusEvent, type WebhookEvent } from './events.js';

const log = logger('webhooks');
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3600_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
let cache: Webhook[] | null = null;
let timer: NodeJS.Timeout | null = null;
let busy = false;

export function invalidateWebhookCache() {
  cache = null;
}

async function enabledWebhooks() {
  cache ??= await prisma().webhook.findMany({ where: { enabled: true } });
  return cache;
}

export function signPayload(secret: string, timestamp: number, body: string) {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

/** Verify a signature header (used by receivers; exported for tests and documentation). */
export function verifySignature(secret: string, header: string, body: string, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = hmacSha256(secret, `${t}.${body}`);
  return typeof parts.v1 === 'string' && safeEqual(parts.v1, expected);
}

export async function validateDestination(url: string) {
  try {
    const { url: u } = await validateUrl(url, { allowPrivate: true });
    if (env().isProduction && u.protocol !== 'https:') throw validationError('Webhook URLs must use HTTPS in production');
  } catch (e) {
    if (e instanceof BlockedDestinationError) throw validationError(`Webhook destination rejected: ${e.message}`);
    throw e;
  }
}

export async function createWebhook(input: { name: string; url: string; events: string[]; accountIds: string[]; allAccounts: boolean; enabled: boolean; createdById: string }) {
  await validateDestination(input.url);
  const events = [...new Set(input.events)].filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!events.length) throw validationError('Select at least one event');
  const secret = 'whsec_' + randomToken(32);
  const row = await prisma().webhook.create({
    data: { name: input.name, url: input.url, events, accountIds: input.accountIds, allAccounts: input.allAccounts, enabled: input.enabled, secretEnc: encryptSecret(secret), createdById: input.createdById },
  });
  invalidateWebhookCache();
  return { webhook: row, secret };
}

export async function rotateSecret(id: string) {
  const secret = 'whsec_' + randomToken(32);
  await prisma().webhook.update({ where: { id }, data: { secretEnc: encryptSecret(secret) } });
  invalidateWebhookCache();
  return secret;
}

export function serializeWebhook(w: Webhook) {
  return {
    id: w.id,
    name: w.name,
    url: w.url,
    events: w.events,
    account_ids: w.accountIds,
    all_accounts: w.allAccounts,
    enabled: w.enabled,
    created_at: w.createdAt.toISOString(),
    updated_at: w.updatedAt.toISOString(),
  };
}

/** Fan out a bus event to matching webhooks by creating persistent delivery records. */
async function enqueue(evt: BusEvent) {
  if (!evt.webhook || !(WEBHOOK_EVENTS as readonly string[]).includes(evt.type)) return;
  const hooks = await enabledWebhooks();
  const matching = hooks.filter((h) => (h.events as string[]).includes(evt.type) && (h.allAccounts || !evt.accountId || (h.accountIds as string[]).includes(evt.accountId)));
  if (!matching.length) return;
  const eventId = 'evt_' + randomToken(16);
  const payload = { id: eventId, type: evt.type, created_at: new Date().toISOString(), account_id: evt.accountId ?? null, data: evt.data };
  await prisma().webhookDelivery.createMany({
    data: matching.map((h) => ({ webhookId: h.id, event: evt.type, eventId, accountId: evt.accountId ?? null, payload: payload as any })),
  });
  void processQueue();
}

async function deliver(hook: Webhook, payload: unknown, eventType: string, eventId: string) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const secret = decryptSecret(hook.secretEnc);
  const started = Date.now();
  const res = await safeFetch(hook.url, {
    method: 'POST',
    body,
    maxBytes: 64 * 1024,
    timeoutMs: 10_000,
    maxRedirects: 0,
    allowPrivate: true,
    headers: {
      'content-type': 'application/json',
      'x-chinwag-event': eventType,
      'x-chinwag-event-id': eventId,
      'x-chinwag-timestamp': String(ts),
      'x-chinwag-signature': signPayload(secret, ts, body),
    },
  });
  return { status: res.status, body: res.body.toString('utf8').slice(0, 1000), durationMs: Date.now() - started };
}

export async function processQueue() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const batch = await prisma().webhookDelivery.findMany({ where: { status: { in: ['PENDING', 'RETRYING'] }, nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: 'asc' }, take: 20, include: { webhook: true } });
      if (!batch.length) break;
      await Promise.all(
        batch.map(async (d) => {
          const claim = await prisma().webhookDelivery.updateMany({ where: { id: d.id, status: d.status }, data: { status: 'DELIVERING', attempts: { increment: 1 } } });
          if (claim.count !== 1) return;
          const attempts = d.attempts + 1;
          if (!d.webhook.enabled) {
            await prisma().webhookDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', errorDetail: 'Webhook disabled' } });
            return;
          }
          try {
            const r = await deliver(d.webhook, d.payload, d.event, d.eventId);
            const ok = r.status >= 200 && r.status < 300;
            await settle(d.id, attempts, ok, { responseStatus: r.status, responseBody: r.body, durationMs: r.durationMs, errorDetail: ok ? null : `HTTP ${r.status}` }, d.webhook);
          } catch (e) {
            await settle(d.id, attempts, false, { errorDetail: errMsg(e).slice(0, 1000) }, d.webhook);
          }
        }),
      );
    }
  } catch (e) {
    log.error('Webhook queue processing failed', { error: errMsg(e) });
  } finally {
    busy = false;
  }
}

async function settle(id: string, attempts: number, ok: boolean, data: Record<string, unknown>, hook: Webhook) {
  if (ok) {
    await prisma().webhookDelivery.update({ where: { id }, data: { ...data, status: 'SUCCEEDED', deliveredAt: new Date() } });
    return;
  }
  if (attempts >= MAX_ATTEMPTS) {
    await prisma().webhookDelivery.update({ where: { id }, data: { ...data, status: 'FAILED' } });
    await audit({ action: 'webhook.delivery_failed', source: 'webhook', result: 'failure', metadata: { webhookId: hook.id, deliveryId: id, attempts } });
    await systemEvent('warn', 'webhooks', `Webhook "${hook.name}" delivery failed after ${attempts} attempts`, { webhookId: hook.id });
    return;
  }
  await prisma().webhookDelivery.update({ where: { id }, data: { ...data, status: 'RETRYING', nextAttemptAt: new Date(Date.now() + BACKOFF_MS[attempts - 1]) } });
}

/** Send a signed test event synchronously and record it in the delivery history. */
export async function testWebhook(id: string) {
  const hook = await prisma().webhook.findUnique({ where: { id } });
  if (!hook) throw notFound('Webhook');
  const eventId = 'evt_test_' + randomToken(12);
  const payload = { id: eventId, type: 'webhook.test', created_at: new Date().toISOString(), account_id: null, data: { message: 'Test event from Chinwag' } };
  const delivery = await prisma().webhookDelivery.create({ data: { webhookId: id, event: 'webhook.test', eventId, payload: payload as any, status: 'DELIVERING', attempts: 1 } });
  try {
    const r = await deliver(hook, payload, 'webhook.test', eventId);
    const ok = r.status >= 200 && r.status < 300;
    await prisma().webhookDelivery.update({ where: { id: delivery.id }, data: { status: ok ? 'SUCCEEDED' : 'FAILED', responseStatus: r.status, responseBody: r.body, durationMs: r.durationMs, deliveredAt: ok ? new Date() : null, errorDetail: ok ? null : `HTTP ${r.status}` } });
    return { ok, status: r.status, duration_ms: r.durationMs, response: r.body.slice(0, 300) };
  } catch (e) {
    await prisma().webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', errorDetail: errMsg(e).slice(0, 1000) } });
    return { ok: false, status: null, error: errMsg(e) };
  }
}

export async function redeliver(deliveryId: string) {
  const d = await prisma().webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!d) throw notFound('Delivery');
  await prisma().webhookDelivery.update({ where: { id: deliveryId }, data: { status: 'RETRYING', nextAttemptAt: new Date(), attempts: 0 } });
  void processQueue();
}

export function startWebhookWorker() {
  bus.on('event', (evt: BusEvent) => void enqueue(evt).catch((e) => log.error('Webhook enqueue failed', { error: errMsg(e) })));
  void prisma()
    .webhookDelivery.updateMany({ where: { status: 'DELIVERING' }, data: { status: 'RETRYING', nextAttemptAt: new Date() } })
    .catch(() => {});
  timer = setInterval(() => void processQueue(), 5000);
  timer.unref();
}

export function stopWebhookWorker() {
  if (timer) clearInterval(timer);
}

export type { WebhookEvent };
