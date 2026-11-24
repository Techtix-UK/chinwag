/**
 * Database-backed scheduler (no Redis). Survives restarts because all state lives in MySQL.
 * A message that was mid-send when the process stopped is marked DELIVERY_UNCERTAIN and never retried.
 */
import { prisma } from '../db/prisma.js';
import type { Prisma, ScheduledMessage } from '../generated/prisma/client.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { errMsg, logger } from '../lib/logger.js';
import { sessionManager } from '../whatsapp/manager.js';
import { audit } from './audit.js';
import { expireClientConfirmations, supersede } from './approvals.js';
import { bus } from './events.js';
import { buildMediaPayload, confirmModeFor, createApproval, execute, PreSendError, SendUncertainError, type OutboundPayload } from './outbound.js';
import { accountFilter, assertCan, isIntegration, type Principal } from './permissions.js';
import { serializeScheduled } from './serializers.js';
import { settings } from './settings.js';

const log = logger('scheduler');
const TICK_MS = 10_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

import { isValidTimezone } from '../lib/time.js';
export { isValidTimezone };

async function toPayload(s: Pick<ScheduledMessage, 'accountId' | 'recipientWaId' | 'body' | 'attachmentId'>): Promise<OutboundPayload> {
  if (s.attachmentId) return buildMediaPayload(s.accountId, s.recipientWaId, s.attachmentId, s.body, 'auto');
  return { kind: 'text', account_id: s.accountId, chat_id: s.recipientWaId, text: s.body ?? '' };
}

export interface ScheduleInput {
  accountId: string;
  recipientWaId: string;
  recipientLabel: string | null;
  body: string | null;
  attachmentId: string | null;
  scheduledAt: Date;
  timezone: string;
}

export async function createScheduled(p: Principal, input: ScheduleInput, source: 'dashboard' | 'api' | 'mcp') {
  assertCan(p, 'schedule:write', input.accountId);
  if (input.attachmentId) assertCan(p, 'media:send', input.accountId);
  if (!input.body?.trim() && !input.attachmentId) throw validationError('A scheduled message needs text or an attachment');
  if (!isValidTimezone(input.timezone)) throw validationError('Unknown timezone');
  if (input.scheduledAt.getTime() < Date.now() - 60_000) throw validationError('scheduled_at must be in the future');
  const policy = isIntegration(p) ? (p.approvalPolicy ?? 'REQUIRE_APPROVAL') : 'DIRECT';
  if (policy === 'READ_ONLY') throw validationError('This integration is read-only and cannot schedule messages');
  const mode = confirmModeFor(p);
  const needsApproval = !!mode;

  const row = await prisma().scheduledMessage.create({
    data: {
      accountId: input.accountId,
      recipientWaId: input.recipientWaId,
      recipientLabel: input.recipientLabel,
      body: input.body,
      attachmentId: input.attachmentId,
      scheduledAt: input.scheduledAt,
      timezone: input.timezone,
      status: needsApproval ? 'AWAITING_APPROVAL' : 'PENDING',
      approvalStatus: needsApproval ? 'PENDING' : 'NOT_REQUIRED',
      createdByType: p.type,
      createdById: p.id,
      createdByLabel: p.label.slice(0, 190),
    },
  });
  let result = row;
  if (needsApproval) {
    const approval = await createApproval(p, await toPayload(row), input.recipientLabel, source, row.id, mode!);
    result = await prisma().scheduledMessage.update({ where: { id: row.id }, data: { approvalId: approval.id } });
  }
  await audit({ action: 'scheduled_message.created', actor: p, source, accountId: input.accountId, metadata: { scheduledId: row.id, chatId: input.recipientWaId, scheduledAt: input.scheduledAt.toISOString(), approval: needsApproval } });
  bus.publish({ type: 'scheduled.changed', accountId: input.accountId, data: { id: row.id } });
  return result;
}

export async function listScheduled(p: Principal, q: { accountId?: string; status?: string; limit: number; offset: number }) {
  const where: Prisma.ScheduledMessageWhereInput = {};
  if (q.accountId) {
    assertCan(p, 'schedule:read', q.accountId);
    where.accountId = q.accountId;
  } else {
    const f = accountFilter(p, 'schedule:read');
    if (f) where.accountId = f;
  }
  if (q.status) where.status = { in: q.status.split(',').map((s) => s.trim().toUpperCase()) as any };
  const [rows, total] = await Promise.all([
    prisma().scheduledMessage.findMany({ where, orderBy: { scheduledAt: 'asc' }, take: q.limit, skip: q.offset }),
    prisma().scheduledMessage.count({ where }),
  ]);
  return { items: rows.map(serializeScheduled), total };
}

export async function getScheduled(p: Principal, id: string) {
  const row = await prisma().scheduledMessage.findUnique({ where: { id } });
  if (!row) throw notFound('Scheduled message');
  assertCan(p, 'schedule:read', row.accountId);
  return row;
}

const EDITABLE = ['PENDING', 'AWAITING_APPROVAL'] as const;

export async function updateScheduled(p: Principal, id: string, patch: { body?: string | null; scheduledAt?: Date; timezone?: string; attachmentId?: string | null }, source: 'dashboard' | 'api' | 'mcp') {
  const row = await getScheduled(p, id);
  assertCan(p, 'schedule:write', row.accountId);
  if (!EDITABLE.includes(row.status as any)) throw conflict(`Cannot modify a scheduled message that is ${row.status.toLowerCase()}`);
  if (patch.timezone && !isValidTimezone(patch.timezone)) throw validationError('Unknown timezone');
  if (patch.scheduledAt && patch.scheduledAt.getTime() < Date.now() - 60_000) throw validationError('scheduled_at must be in the future');
  const contentChanged = (patch.body !== undefined && patch.body !== row.body) || (patch.attachmentId !== undefined && patch.attachmentId !== row.attachmentId);
  const timeChanged = patch.scheduledAt !== undefined && patch.scheduledAt.getTime() !== row.scheduledAt.getTime();
  const needsApproval = !!confirmModeFor(p);
  if (isIntegration(p) && p.approvalPolicy === 'READ_ONLY') throw validationError('This integration is read-only');

  const data: Prisma.ScheduledMessageUpdateInput = {
    ...(patch.body !== undefined ? { body: patch.body } : {}),
    ...(patch.attachmentId !== undefined ? { attachmentId: patch.attachmentId } : {}),
    ...(patch.scheduledAt ? { scheduledAt: patch.scheduledAt } : {}),
    ...(patch.timezone ? { timezone: patch.timezone } : {}),
    errorDetail: null,
  };
  const merged = { ...row, ...(patch.body !== undefined ? { body: patch.body } : {}), ...(patch.attachmentId !== undefined ? { attachmentId: patch.attachmentId } : {}) };
  if (!merged.body?.trim() && !merged.attachmentId) throw validationError('A scheduled message needs text or an attachment');

  // Any modification of a message that required approval needs renewed approval.
  const reapprove = needsApproval && (contentChanged || timeChanged);
  let updated = await prisma().scheduledMessage.update({ where: { id }, data });
  if (reapprove) {
    if (row.approvalId) await supersede(row.approvalId);
    const approval = await createApproval(p, await toPayload(updated), updated.recipientLabel, source, id);
    updated = await prisma().scheduledMessage.update({ where: { id }, data: { status: 'AWAITING_APPROVAL', approvalStatus: 'PENDING', approvalId: approval.id } });
  } else if (row.status === 'AWAITING_APPROVAL' && !isIntegration(p) && contentChanged && row.approvalId) {
    // A human editor with send permission takes responsibility; the stale approval is superseded.
    await supersede(row.approvalId);
    updated = await prisma().scheduledMessage.update({ where: { id }, data: { status: 'PENDING', approvalStatus: 'NOT_REQUIRED', approvalId: null } });
  }
  await audit({ action: 'scheduled_message.updated', actor: p, source, accountId: row.accountId, metadata: { scheduledId: id, contentChanged, timeChanged, reapprove } });
  bus.publish({ type: 'scheduled.changed', accountId: row.accountId, data: { id } });
  return updated;
}

export async function cancelScheduled(p: Principal, id: string, source: 'dashboard' | 'api' | 'mcp') {
  const row = await getScheduled(p, id);
  assertCan(p, 'schedule:write', row.accountId);
  const res = await prisma().scheduledMessage.updateMany({ where: { id, status: { in: ['PENDING', 'AWAITING_APPROVAL'] } }, data: { status: 'CANCELLED' } });
  if (res.count !== 1) throw conflict(`Cannot cancel a scheduled message that is ${row.status.toLowerCase()}`);
  if (row.approvalId) await supersede(row.approvalId);
  await audit({ action: 'scheduled_message.cancelled', actor: p, source, accountId: row.accountId, metadata: { scheduledId: id } });
  bus.publish({ type: 'scheduled.changed', accountId: row.accountId, data: { id } });
  return prisma().scheduledMessage.findUniqueOrThrow({ where: { id } });
}

// ─────────────────────────────── worker ───────────────────────────────

/** On start-up, anything left PROCESSING may or may not have been sent — never retry it automatically. */
export async function recoverInterrupted() {
  const res = await prisma().scheduledMessage.updateMany({
    where: { status: 'PROCESSING' },
    data: { status: 'DELIVERY_UNCERTAIN', errorDetail: 'Application stopped while this message was being sent. Check the conversation before resending.' },
  });
  if (res.count) log.warn('Marked interrupted scheduled messages as delivery uncertain', { count: res.count });
}

export async function tick(now = new Date()) {
  if (running) return;
  running = true;
  try {
    await expireClientConfirmations();
    const due = await prisma().scheduledMessage.findMany({ where: { status: 'PENDING', scheduledAt: { lte: now } }, orderBy: { scheduledAt: 'asc' }, take: 25 });
    const expiryMs = settings().scheduledExpiryMinutes * 60_000;
    for (const s of due) {
      if (!sessionManager().isReady(s.accountId)) {
        if (now.getTime() - s.scheduledAt.getTime() > expiryMs) {
          await finish(s, 'EXPIRED', { errorDetail: `Account was not connected within ${settings().scheduledExpiryMinutes} minutes of the scheduled time` });
        } else if (!s.errorDetail?.startsWith('Waiting')) {
          await prisma().scheduledMessage.update({ where: { id: s.id }, data: { errorDetail: 'Waiting for the WhatsApp account to reconnect' } });
        }
        continue;
      }
      const claim = await prisma().scheduledMessage.updateMany({ where: { id: s.id, status: 'PENDING' }, data: { status: 'PROCESSING', attempts: { increment: 1 }, lastAttemptAt: new Date() } });
      if (claim.count !== 1) continue;
      try {
        const payload = await toPayload(s);
        const res = await execute(payload, { sentByUserId: s.createdByType === 'user' ? s.createdById : null, sentVia: 'scheduler' });
        await finish(s, 'SENT', { sentAt: new Date(), sentMessageId: res.wa_message_id, errorDetail: null });
      } catch (e) {
        if (e instanceof SendUncertainError) await finish(s, 'DELIVERY_UNCERTAIN', { errorDetail: e.message });
        else if (e instanceof PreSendError || (e as any)?.status === 404) await finish(s, 'FAILED', { errorDetail: errMsg(e) });
        else if ((e as any)?.status === 503) {
          // Account dropped between the readiness check and the send; nothing was dispatched.
          await prisma().scheduledMessage.update({ where: { id: s.id }, data: { status: 'PENDING', errorDetail: 'Waiting for the WhatsApp account to reconnect' } });
        } else await finish(s, 'DELIVERY_UNCERTAIN', { errorDetail: errMsg(e) });
      }
    }
  } catch (e) {
    log.error('Scheduler tick failed', { error: errMsg(e) });
  } finally {
    running = false;
  }
}

async function finish(s: ScheduledMessage, status: 'SENT' | 'FAILED' | 'EXPIRED' | 'DELIVERY_UNCERTAIN', data: Prisma.ScheduledMessageUpdateInput) {
  const updated = await prisma().scheduledMessage.update({ where: { id: s.id }, data: { status, ...data } });
  const ok = status === 'SENT';
  await audit({ action: ok ? 'scheduled_message.sent' : 'scheduled_message.failed', source: 'scheduler', accountId: s.accountId, result: ok ? 'success' : 'failure', metadata: { scheduledId: s.id, status: status.toLowerCase() } });
  bus.publish({ type: ok ? 'scheduled_message.sent' : 'scheduled_message.failed', accountId: s.accountId, data: { scheduled_message: serializeScheduled(updated) }, webhook: true });
  bus.publish({ type: 'scheduled.changed', accountId: s.accountId, data: { id: s.id } });
}

export function startScheduler() {
  void recoverInterrupted().then(() => tick());
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
}
