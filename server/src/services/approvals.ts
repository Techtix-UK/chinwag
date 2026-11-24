import { prisma } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { bus } from './events.js';
import { execute, payloadHash, PreSendError, SendUncertainError, type OutboundPayload } from './outbound.js';
import { accountFilter, assertCan, type Principal } from './permissions.js';
import { serializeApproval } from './serializers.js';

export async function listApprovals(p: Principal, q: { status?: string; accountId?: string; limit: number; offset: number }) {
  const where: Prisma.MessageApprovalWhereInput = {};
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

export async function decide(p: Principal, id: string, decision: 'approve' | 'reject', note?: string | null) {
  if (p.type !== 'user') throw new AppError(403, 'forbidden', 'Only dashboard users can review approvals');
  const a = await prisma().messageApproval.findUnique({ where: { id } });
  if (!a) throw notFound('Approval');
  assertCan(p, 'approvals:review', a.accountId);
  if (a.status !== 'PENDING') throw conflict(`Approval is already ${a.status.toLowerCase()}`);

  // The decision applies only to the exact stored payload.
  const payload = a.payload as unknown as OutboundPayload;
  if (payloadHash(payload) !== a.payloadHash) throw conflict('Approval payload integrity check failed');

  const claimed = await prisma().messageApproval.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: decision === 'approve' ? 'APPROVED' : 'REJECTED', decidedByUserId: p.id, decidedAt: new Date(), decisionNote: note?.slice(0, 500) ?? null },
  });
  if (claimed.count !== 1) throw conflict('Approval was decided concurrently');

  let updated = await prisma().messageApproval.findUniqueOrThrow({ where: { id } });
  if (a.scheduledMessageId) {
    // Scheduled message: approval releases it to the scheduler (or cancels it).
    await prisma().scheduledMessage.updateMany({
      where: { id: a.scheduledMessageId, approvalId: id, status: 'AWAITING_APPROVAL' },
      data: decision === 'approve' ? { status: 'PENDING', approvalStatus: 'APPROVED' } : { status: 'CANCELLED', approvalStatus: 'REJECTED', errorDetail: 'Rejected by reviewer' },
    });
    bus.publish({ type: 'scheduled.changed', accountId: a.accountId, data: { id: a.scheduledMessageId } });
  } else if (decision === 'approve') {
    try {
      const res = await execute(payload, { sentByUserId: p.id, sentVia: a.requestedByType === 'oauth' ? 'mcp' : 'api' });
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

  await audit({ action: `approval.${decision === 'approve' ? 'approved' : 'rejected'}`, actor: p, accountId: a.accountId, metadata: { approvalId: id, outcome: updated.status.toLowerCase() } });
  const data = serializeApproval(updated);
  bus.publish({ type: 'approval.completed', accountId: a.accountId, data: { approval: data, decision }, webhook: true });
  bus.publish({ type: 'approval.changed', accountId: a.accountId, audience: 'reviewers', data: { approval: data } });
  return updated;
}

/** Invalidate a pending approval when the underlying request is modified. */
export async function supersede(approvalId: string) {
  await prisma().messageApproval.updateMany({ where: { id: approvalId, status: 'PENDING' }, data: { status: 'SUPERSEDED', decisionNote: 'Request was modified — new approval required' } });
}
