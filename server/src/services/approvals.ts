import { prisma } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { bus } from './events.js';
import { execute, payloadHash, PreSendError, SendUncertainError, type OutboundPayload } from './outbound.js';
import { accountFilter, assertCan, type Principal } from './permissions.js';
import { serializeApproval } from './serializers.js';

export async function listApprovals(p: Principal, q: { status?: string; accountId?: string; limit: number; offset: number; includeChatOnly?: boolean }) {
  const where: Prisma.MessageApprovalWhereInput = {};
  // Requests that only the requester can confirm (in ChatGPT) are hidden from the review queue unless asked for.
  if (!q.includeChatOnly) where.confirmMode = { in: ['dashboard', 'either'] };
  if (q.accountId) {
    assertCan(p, 'approvals:review', q.accountId);
    where.accountId = q.accountId;
  } else {
    const f = accountFilter(p, 'approvals:review');
    if (f) where.accountId = f;
  }
  if (q.status) where.status = q.status.toUpperCase() as any;
  const [rows, total] = await Promise.all([
    prisma().messageApproval.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit, skip: q.offset }),
    prisma().messageApproval.count({ where }),
  ]);
  return { items: rows.map(serializeApproval), total };
}

/** Integrations may read the status of approvals they requested. */
export async function getApprovalFor(p: Principal, id: string) {
  const a = await prisma().messageApproval.findUnique({ where: { id } });
  if (!a) throw notFound('Approval');
  const own = a.requestedByType === p.type && a.requestedById === p.id;
  if (!own) assertCan(p, 'approvals:review', a.accountId);
  return a;
}

type Decision = 'approve' | 'reject';

/** Dashboard reviewer decision. Chat-only requests can be rejected here but only confirmed in the MCP client. */
export async function decide(p: Principal, id: string, decision: Decision, note?: string | null) {
  if (p.type !== 'user') throw new AppError(403, 'forbidden', 'Only dashboard users can review approvals');
  const a = await prisma().messageApproval.findUnique({ where: { id } });
  if (!a) throw notFound('Approval');
  assertCan(p, 'approvals:review', a.accountId);
  if (decision === 'approve' && a.confirmMode === 'client') {
    throw conflict('This request is set to be confirmed in ChatGPT by the person who asked for it. You can reject it here.');
  }
  return finalize(a, decision, { userId: p.id, actor: p, note: note ?? null, via: 'dashboard' });
}

/**
 * Confirmation from inside the MCP client (e.g. ChatGPT) by the same connection that requested it.
 * The human confirmation happens in the client; the server enforces that only the requesting
 * connection can confirm, only for chat-confirmable requests, only before expiry, and only for the exact payload.
 */
export async function confirmInClient(p: Principal, id: string, decision: Decision) {
  if (p.type !== 'oauth') throw new AppError(403, 'forbidden', 'Only MCP connections can confirm requests in the client');
  const a = await prisma().messageApproval.findUnique({ where: { id } });
  if (!a || a.requestedByType !== p.type || a.requestedById !== p.id) throw notFound('Pending request');
  if (a.confirmMode === 'dashboard') throw conflict('This request must be approved by a reviewer in the Chinwag dashboard');
  if (a.status !== 'PENDING') throw conflict(`This request is already ${a.status.toLowerCase()}`);
  if (a.expiresAt && a.expiresAt < new Date()) {
    await prisma().messageApproval.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', decisionNote: 'Expired before it was confirmed', decidedAt: new Date() } });
    if (a.scheduledMessageId) await prisma().scheduledMessage.updateMany({ where: { id: a.scheduledMessageId, status: 'AWAITING_APPROVAL' }, data: { status: 'CANCELLED', approvalStatus: 'EXPIRED', errorDetail: 'Confirmation expired' } });
    throw new AppError(410, 'confirmation_expired', 'This draft expired before it was confirmed. Ask again to create a new one.');
  }
  return finalize(a, decision, { userId: p.userId ?? null, actor: p, note: decision === 'approve' ? 'Confirmed in ChatGPT' : 'Cancelled in ChatGPT', via: 'mcp' });
}

async function finalize(
  a: NonNullable<Awaited<ReturnType<ReturnType<typeof prisma>['messageApproval']['findUnique']>>>,
  decision: Decision,
  ctx: { userId: string | null; actor: Principal; note: string | null; via: 'dashboard' | 'mcp' },
) {
  const id = a.id;
  if (a.status !== 'PENDING') throw conflict(`Approval is already ${a.status.toLowerCase()}`);
  // The decision applies only to the exact stored payload.
  const payload = a.payload as unknown as OutboundPayload;
  if (payloadHash(payload) !== a.payloadHash) throw conflict('Approval payload integrity check failed');

  const claimed = await prisma().messageApproval.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: decision === 'approve' ? 'APPROVED' : 'REJECTED', decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: ctx.note?.slice(0, 500) ?? null },
  });
  if (claimed.count !== 1) throw conflict('Approval was decided concurrently');

  let updated = await prisma().messageApproval.findUniqueOrThrow({ where: { id } });
  if (a.scheduledMessageId) {
    // Scheduled message: approval releases it to the scheduler (or cancels it).
    await prisma().scheduledMessage.updateMany({
      where: { id: a.scheduledMessageId, approvalId: id, status: 'AWAITING_APPROVAL' },
      data: decision === 'approve' ? { status: 'PENDING', approvalStatus: 'APPROVED' } : { status: 'CANCELLED', approvalStatus: 'REJECTED', errorDetail: ctx.via === 'mcp' ? 'Cancelled in ChatGPT' : 'Rejected by reviewer' },
    });
    bus.publish({ type: 'scheduled.changed', accountId: a.accountId, data: { id: a.scheduledMessageId } });
  } else if (decision === 'approve') {
    try {
      const res = await execute(payload, { sentByUserId: ctx.userId, sentVia: a.requestedByType === 'oauth' ? 'mcp' : 'api' });
      updated = await prisma().messageApproval.update({ where: { id }, data: { status: 'EXECUTED', resultMessageId: res.wa_message_id } });
    } catch (e) {
      const uncertain = e instanceof SendUncertainError;
      updated = await prisma().messageApproval.update({
        where: { id },
        data: { status: 'FAILED', errorDetail: (uncertain ? 'Delivery uncertain: ' : '') + (e instanceof Error ? e.message : String(e)) },
      });
      if (!(e instanceof PreSendError) && !uncertain && !(e instanceof AppError)) throw e;
    }
  }

  await audit({
    action: ctx.via === 'mcp' ? `approval.${decision === 'approve' ? 'confirmed_in_client' : 'cancelled_in_client'}` : `approval.${decision === 'approve' ? 'approved' : 'rejected'}`,
    actor: ctx.actor,
    source: ctx.via,
    accountId: a.accountId,
    metadata: { approvalId: id, outcome: updated.status.toLowerCase() },
  });
  const data = serializeApproval(updated);
  bus.publish({ type: 'approval.completed', accountId: a.accountId, data: { approval: data, decision, via: ctx.via }, webhook: true });
  bus.publish({ type: 'approval.changed', accountId: a.accountId, audience: 'reviewers', data: { approval: data } });
  return updated;
}

/** Expire chat confirmations that were never confirmed (and cancel their scheduled messages). */
export async function expireClientConfirmations() {
  const expired = await prisma().messageApproval.findMany({ where: { status: 'PENDING', confirmMode: 'client', expiresAt: { lt: new Date() } }, take: 200 });
  for (const a of expired) {
    const r = await prisma().messageApproval.updateMany({ where: { id: a.id, status: 'PENDING' }, data: { status: 'REJECTED', decisionNote: 'Expired before it was confirmed', decidedAt: new Date() } });
    if (r.count && a.scheduledMessageId) {
      await prisma().scheduledMessage.updateMany({ where: { id: a.scheduledMessageId, status: 'AWAITING_APPROVAL' }, data: { status: 'CANCELLED', approvalStatus: 'EXPIRED', errorDetail: 'Confirmation expired' } });
    }
  }
  return expired.length;
}

/** Invalidate a pending approval when the underlying request is modified. */
export async function supersede(approvalId: string) {
  await prisma().messageApproval.updateMany({ where: { id: approvalId, status: 'PENDING' }, data: { status: 'SUPERSEDED', decisionNote: 'Request was modified — new approval required' } });
}
