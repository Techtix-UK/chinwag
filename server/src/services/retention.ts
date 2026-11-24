import { prisma } from '../db/prisma.js';
import { logger, errMsg } from '../lib/logger.js';
import { deleteAttachmentFile } from './media.js';
import { settings } from './settings.js';

const log = logger('retention');
const DAY = 86_400_000;
let timer: NodeJS.Timeout | null = null;

/** Applies configured retention periods (0 = keep forever) and clears expired security records. */
export async function runRetention() {
  const s = settings();
  const now = Date.now();
  try {
    await prisma().userSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await prisma().oAuthAuthorizationRequest.deleteMany({ where: { expiresAt: { lt: new Date(now - DAY) } } });
    await prisma().oAuthToken.deleteMany({ where: { expiresAt: { lt: new Date(now - 7 * DAY) } } });
    await prisma().idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(now - 7 * DAY) } } });
    await prisma().webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(now - 30 * DAY) }, status: { in: ['SUCCEEDED', 'FAILED'] } } });
    await prisma().systemEvent.deleteMany({ where: { timestamp: { lt: new Date(now - 90 * DAY) } } });
    if (s.auditRetentionDays > 0) await prisma().auditLog.deleteMany({ where: { timestamp: { lt: new Date(now - s.auditRetentionDays * DAY) } } });
    if (s.mediaRetentionDays > 0) {
      const old = await prisma().messageAttachment.findMany({ where: { state: 'STORED', createdAt: { lt: new Date(now - s.mediaRetentionDays * DAY) } }, take: 1000 });
      for (const a of old) await deleteAttachmentFile(a).catch(() => {});
    }
    // Uploaded attachments that were never sent are removed after a day.
    const orphans = await prisma().messageAttachment.findMany({ where: { messageId: null, state: 'STORED', createdAt: { lt: new Date(now - DAY) } }, take: 500 });
    for (const a of orphans) {
      const referenced = await prisma().scheduledMessage.count({ where: { attachmentId: a.id, status: { in: ['PENDING', 'AWAITING_APPROVAL', 'PROCESSING'] } } });
      const pendingApproval = await prisma().messageApproval.count({ where: { status: 'PENDING', payload: { path: '$.attachment_id', equals: a.id } } }).catch(() => 1);
      if (!referenced && !pendingApproval) await deleteAttachmentFile(a).catch(() => {});
    }
    if (s.messageRetentionDays > 0) {
      const cutoff = new Date(now - s.messageRetentionDays * DAY);
      const old = await prisma().messageAttachment.findMany({ where: { state: 'STORED', message: { timestamp: { lt: cutoff } } }, take: 1000 });
      for (const a of old) await deleteAttachmentFile(a).catch(() => {});
      await prisma().message.deleteMany({ where: { timestamp: { lt: cutoff } } });
    }
  } catch (e) {
    log.error('Retention run failed', { error: errMsg(e) });
  }
}

export function startRetention() {
  setTimeout(() => void runRetention(), 60_000).unref();
  timer = setInterval(() => void runRetention(), 6 * 3600_000);
  timer.unref();
}
export function stopRetention() {
  if (timer) clearInterval(timer);
}
