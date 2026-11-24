/**
 * Outbound messaging pipeline shared by the dashboard, REST API, MCP tools, approvals and scheduler.
 *
 *  request → permission check → recipient resolution → approval policy → execute
 *
 * Integrations (API keys / OAuth clients) are subject to their approval policy. A message that is
 * queued for approval is NEVER reported as sent.
 */
import wwebjs from 'whatsapp-web.js';
import { prisma } from '../db/prisma.js';
import { AppError, forbidden, notFound, validationError } from '../lib/errors.js';
import { canonicalJson, sha256 } from '../lib/crypto.js';
import { isChatId, normaliseInternational, formatInternational, digitsOnly } from '../lib/phone.js';
import { errMsg, logger } from '../lib/logger.js';
import { sessionManager } from '../whatsapp/manager.js';
import { upsertMessage } from '../whatsapp/sync.js';
import { audit } from './audit.js';
import { bus } from './events.js';
import { mediaKind, readAttachmentBuffer } from './media.js';
import { assertCan, isIntegration, type Principal } from './permissions.js';
import { serializeApproval, serializeMessage } from './serializers.js';

const log = logger('outbound');
const { MessageMedia } = wwebjs;

export type RecipientInput = { chat_id?: string; phone_number?: string; contact_id?: string; name?: string };

export interface ResolvedRecipient {
  waChatId: string;
  label: string | null;
}

export interface Candidate {
  chat_id: string;
  name: string | null;
  phone_number: string | null;
  type: 'individual' | 'group';
  last_message_at: string | null;
}

export class AmbiguousRecipientError extends AppError {
  constructor(public candidates: Candidate[], message = 'Recipient is ambiguous — choose one of the candidates and retry with its chat_id') {
    super(409, 'ambiguous_recipient', message, { candidates });
  }
}

/** Errors raised before anything was handed to WhatsApp (safe to report as not sent). */
export class PreSendError extends AppError {}
/** The send call itself failed; WhatsApp may or may not have accepted the message. */
export class SendUncertainError extends AppError {
  constructor(message: string) {
    super(502, 'delivery_uncertain', message);
  }
}

/**
 * Resolve a recipient without guessing. Exact chat IDs and validated phone numbers resolve directly;
 * names only resolve when exactly one exact (case-insensitive) match exists — otherwise candidates are returned.
 */
export async function resolveRecipient(accountId: string, input: RecipientInput, opts: { validateOnWhatsApp?: boolean } = {}): Promise<ResolvedRecipient> {
  const provided = ['chat_id', 'phone_number', 'contact_id', 'name'].filter((k) => (input as any)[k]);
  if (provided.length !== 1) throw validationError('Provide exactly one of chat_id, phone_number, contact_id or name');

  if (input.chat_id) {
    const id = input.chat_id.trim();
    if (isChatId(id)) {
      const chat = await prisma().chat.findUnique({ where: { accountId_waChatId: { accountId, waChatId: id } } });
      return { waChatId: id, label: chat?.name ?? null };
    }
    const chat = await prisma().chat.findFirst({ where: { id, accountId } });
    if (!chat) throw notFound('Chat');
    return { waChatId: chat.waChatId, label: chat.name };
  }

  if (input.contact_id) {
    const c = await prisma().contact.findFirst({ where: { id: input.contact_id, accountId } });
    if (!c) throw notFound('Contact');
    return { waChatId: c.waId, label: c.displayName || c.profileName || formatInternational(c.phoneNumber) };
  }

  if (input.phone_number) {
    const digits = normaliseInternational(input.phone_number);
    if (!digits) throw validationError('phone_number must be in international format, e.g. +44 7700 900123');
    if (opts.validateOnWhatsApp !== false) {
      const client = sessionManager().requireClient(accountId);
      const wid = await client.getNumberId(digits).catch(() => null);
      if (!wid) throw new AppError(422, 'not_on_whatsapp', `${formatInternational(digits)} could not be resolved on WhatsApp`);
      return { waChatId: wid._serialized, label: formatInternational(digits) };
    }
    return { waChatId: `${digits}@c.us`, label: formatInternational(digits) };
  }

  const name = input.name!.trim();
  const candidates = await findCandidates(accountId, name, 10);
  const exact = candidates.filter((c) => (c.name ?? '').toLowerCase() === name.toLowerCase());
  if (exact.length === 1) return { waChatId: exact[0].chat_id, label: exact[0].name };
  if (!candidates.length) throw new AppError(404, 'recipient_not_found', `No chat or contact matches "${name}"`, { candidates: [] });
  throw new AmbiguousRecipientError(candidates);
}

export async function findCandidates(accountId: string, term: string, limit: number): Promise<Candidate[]> {
  const digits = digitsOnly(term);
  const [chats, contacts] = await Promise.all([
    prisma().chat.findMany({ where: { accountId, OR: [{ name: { contains: term } }, ...(digits.length >= 4 ? [{ waChatId: { contains: digits } }] : [])] }, take: limit, orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } } }),
    prisma().contact.findMany({
      where: { accountId, isGroup: false, OR: [{ displayName: { contains: term } }, { profileName: { contains: term } }, ...(digits.length >= 4 ? [{ phoneNumber: { contains: digits } }] : [])] },
      take: limit,
    }),
  ]);
  const out = new Map<string, Candidate>();
  for (const c of chats) out.set(c.waChatId, { chat_id: c.waChatId, name: c.name, phone_number: c.isGroup ? null : formatInternational(c.waChatId.split('@')[0].replace(/\D/g, '') || null), type: c.isGroup ? 'group' : 'individual', last_message_at: c.lastMessageAt?.toISOString() ?? null });
  for (const c of contacts) {
    const existing = out.get(c.waId);
    out.set(c.waId, {
      chat_id: c.waId,
      name: c.displayName || c.profileName || existing?.name || null,
      phone_number: formatInternational(c.phoneNumber),
      type: 'individual',
      last_message_at: existing?.last_message_at ?? c.lastInteractionAt?.toISOString() ?? null,
    });
  }
  return [...out.values()].slice(0, limit);
}

// ─────────────────────────────── payloads ───────────────────────────────

export type OutboundPayload =
  | { kind: 'text'; account_id: string; chat_id: string; text: string; quoted_message_id?: string | null }
  | {
      kind: 'media';
      account_id: string;
      chat_id: string;
      attachment_id: string;
      attachment_checksum: string;
      caption?: string | null;
      send_as?: 'auto' | 'document' | 'voice';
      quoted_message_id?: string | null;
    }
  | { kind: 'reaction'; account_id: string; chat_id: string; message_id: string; emoji: string };

export function payloadHash(p: OutboundPayload): string {
  return sha256(canonicalJson(p));
}

export type SendOutcome =
  | { status: 'sent'; message: ReturnType<typeof serializeMessage> | null; wa_message_id: string | null }
  | { status: 'pending_approval'; approval_id: string; approval: ReturnType<typeof serializeApproval> };

/** Entry point for every outbound request. */
export async function requestSend(principal: Principal, payload: OutboundPayload, ctx: { source: 'dashboard' | 'api' | 'mcp'; recipientLabel?: string | null; ip?: string }): Promise<SendOutcome> {
  assertCan(principal, 'messages:send', payload.account_id);
  if (payload.kind === 'media') assertCan(principal, 'media:send', payload.account_id);
  if (isIntegration(principal)) {
    const policy = principal.approvalPolicy ?? 'REQUIRE_APPROVAL';
    if (policy === 'READ_ONLY') {
      await audit({ action: 'message.send_denied', actor: principal, source: ctx.source, accountId: payload.account_id, result: 'denied', metadata: { reason: 'read_only_policy' } });
      throw forbidden('This integration is read-only and cannot send messages');
    }
    if (policy === 'REQUIRE_APPROVAL') {
      const approval = await createApproval(principal, payload, ctx.recipientLabel ?? null, ctx.source);
      return { status: 'pending_approval', approval_id: approval.id, approval: serializeApproval(approval) };
    }
  }
  const result = await execute(payload, { sentByUserId: principal.type === 'user' ? principal.id : principal.userId ?? null, sentVia: ctx.source });
  await audit({
    action: payload.kind === 'reaction' ? 'message.reacted' : 'message.sent',
    actor: principal,
    source: ctx.source,
    accountId: payload.account_id,
    metadata: { chatId: payload.chat_id, kind: payload.kind, waMessageId: result.wa_message_id, length: payload.kind === 'text' ? payload.text.length : undefined },
  });
  return result;
}

export async function createApproval(principal: Principal, payload: OutboundPayload, recipientLabel: string | null, source: string, scheduledMessageId?: string) {
  const approval = await prisma().messageApproval.create({
    data: {
      accountId: payload.account_id,
      kind: payload.kind,
      recipientWaId: payload.chat_id,
      recipientLabel,
      payload: payload as any,
      payloadHash: payloadHash(payload),
      scheduledMessageId: scheduledMessageId ?? null,
      requestedByType: principal.type,
      requestedById: principal.id,
      requestedByLabel: principal.label.slice(0, 190),
    },
  });
  await audit({ action: 'approval.requested', actor: principal, source: source as any, accountId: payload.account_id, result: 'pending', metadata: { approvalId: approval.id, kind: payload.kind, chatId: payload.chat_id } });
  const data = serializeApproval(approval);
  bus.publish({ type: 'approval.requested', accountId: payload.account_id, data: { approval: data }, webhook: true });
  bus.publish({ type: 'approval.changed', accountId: payload.account_id, audience: 'reviewers', data: { approval: data } });
  return approval;
}

/** Execute an already-authorised payload against WhatsApp. */
export async function execute(payload: OutboundPayload, meta: { sentByUserId?: string | null; sentVia: string }): Promise<Extract<SendOutcome, { status: 'sent' }>> {
  const client = sessionManager().requireClient(payload.account_id);

  if (payload.kind === 'reaction') {
    const msgRow = await prisma().message.findFirst({ where: { accountId: payload.account_id, OR: [{ id: payload.message_id }, { waMessageId: payload.message_id }] } });
    if (!msgRow) throw new PreSendError(404, 'not_found', 'Message not found');
    let waMsg;
    try {
      waMsg = await client.getMessageById(msgRow.waMessageId);
    } catch {
      waMsg = null;
    }
    if (!waMsg) throw new PreSendError(422, 'message_unavailable', 'Message is no longer available in WhatsApp Web');
    try {
      await waMsg.react(payload.emoji);
    } catch (e) {
      throw new SendUncertainError(`Reaction may not have been applied: ${errMsg(e)}`);
    }
    return { status: 'sent', message: null, wa_message_id: msgRow.waMessageId };
  }

  let quotedWaId: string | undefined;
  if (payload.quoted_message_id) {
    const q = await prisma().message.findFirst({ where: { accountId: payload.account_id, OR: [{ id: payload.quoted_message_id }, { waMessageId: payload.quoted_message_id }] } });
    if (!q) throw new PreSendError(404, 'not_found', 'Quoted message not found');
    quotedWaId = q.waMessageId;
  }

  let content: string | InstanceType<typeof MessageMedia>;
  const options: Record<string, unknown> = { linkPreview: false, waitUntilMsgSent: true };
  if (quotedWaId) options.quotedMessageId = quotedWaId;

  if (payload.kind === 'text') {
    if (!payload.text.trim()) throw new PreSendError(422, 'validation_error', 'Message text is empty');
    content = payload.text;
  } else {
    const att = await prisma().messageAttachment.findFirst({ where: { id: payload.attachment_id, accountId: payload.account_id } });
    if (!att || att.state !== 'STORED') throw new PreSendError(404, 'not_found', 'Attachment not found or not stored');
    if (att.checksum !== payload.attachment_checksum) throw new PreSendError(409, 'attachment_changed', 'Attachment changed after the request was made');
    const buffer = await readAttachmentBuffer(att).catch(() => null);
    if (!buffer) throw new PreSendError(404, 'not_found', 'Attachment file missing from storage');
    content = new MessageMedia(att.mimeType, buffer.toString('base64'), att.originalFilename ?? undefined, buffer.length);
    if (payload.caption) options.caption = payload.caption;
    const kind = mediaKind(att.mimeType);
    if (payload.send_as === 'document' || kind === 'document') options.sendMediaAsDocument = true;
    if (payload.send_as === 'voice' && kind === 'audio') options.sendAudioAsVoice = true;
  }

  let sent;
  try {
    sent = await client.sendMessage(payload.chat_id, content as any, options as any);
  } catch (e) {
    log.warn('sendMessage failed', { accountId: payload.account_id, error: errMsg(e) });
    const m = errMsg(e);
    // Known pre-flight failures from whatsapp-web.js where nothing was dispatched
    if (/wid error|invalid wid|no lid for user|chat not found/i.test(m)) throw new PreSendError(422, 'invalid_recipient', `Recipient is not valid on WhatsApp: ${m}`);
    throw new SendUncertainError(`WhatsApp did not confirm the message: ${m}`);
  }
  if (!sent?.id?._serialized) throw new SendUncertainError('WhatsApp did not return a message ID');

  const res = await upsertMessage(payload.account_id, sent, { live: true, sentByUserId: meta.sentByUserId ?? null, sentVia: meta.sentVia });
  if (res && payload.kind === 'media') {
    // Link the stored attachment to the sent message (replacing the placeholder created by sync).
    await prisma().$transaction([
      prisma().messageAttachment.deleteMany({ where: { messageId: res.message.id, state: 'NOT_DOWNLOADED' } }),
      prisma().messageAttachment.update({ where: { id: payload.attachment_id }, data: { messageId: res.message.id } }),
    ]);
  }
  const full = res ? await prisma().message.findUnique({ where: { id: res.message.id }, include: { attachments: true, reactions: true } }) : null;
  if (full) bus.publish({ type: 'message.upsert', accountId: payload.account_id, data: { message: serializeMessage(full) } });
  return { status: 'sent', message: full ? serializeMessage(full) : null, wa_message_id: sent.id._serialized };
}

/** Build a payload from validated API input (attachment checksum is captured now so approval binds to the exact file). */
export async function buildMediaPayload(accountId: string, chatId: string, attachmentId: string, caption: string | null | undefined, sendAs: 'auto' | 'document' | 'voice' | undefined, quoted?: string | null): Promise<OutboundPayload> {
  const att = await prisma().messageAttachment.findFirst({ where: { id: attachmentId, accountId } });
  if (!att || att.state !== 'STORED' || !att.checksum) throw notFound('Attachment');
  return { kind: 'media', account_id: accountId, chat_id: chatId, attachment_id: att.id, attachment_checksum: att.checksum, caption: caption ?? null, send_as: sendAs ?? 'auto', quoted_message_id: quoted ?? null };
}
