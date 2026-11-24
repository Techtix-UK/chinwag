import { prisma } from '../db/prisma.js';
import { logger, errMsg } from '../lib/logger.js';
import { waIdToPhone } from '../lib/phone.js';
import { bus } from '../services/events.js';
import { settings } from '../services/settings.js';
import { maxBytes, storeBuffer } from '../services/media.js';
import { serializeMessage, serializeChat } from '../services/serializers.js';
import { IGNORED_TYPES, MEDIA_TYPES, ackToStatus, documentFilename, mapMessage, previewOf } from './mapping.js';
import type { WaChat, WaClient, WaContact, WaGroupChat, WaMessage } from './types.js';
import type { Chat, Message } from '../generated/prisma/client.js';

const log = logger('sync');

/** Per-account cache of waChatId → db chat id to avoid a lookup per message. */
const chatIdCache = new Map<string, string>();
const cacheKey = (a: string, c: string) => `${a}|${c}`;

export function clearChatCache(accountId: string) {
  for (const k of chatIdCache.keys()) if (k.startsWith(accountId + '|')) chatIdCache.delete(k);
}

function isStatusBroadcast(waChatId: string) {
  return waChatId === 'status@broadcast' || waChatId.endsWith('@broadcast') || waChatId.endsWith('@newsletter');
}

export async function upsertChat(accountId: string, chat: WaChat, extra: { profilePicUrl?: string | null } = {}): Promise<Chat | null> {
  const waChatId = chat.id._serialized;
  if (isStatusBroadcast(waChatId)) return null;
  const group = chat.isGroup ? (chat as WaGroupChat) : null;
  const last = chat.lastMessage;
  const data = {
    name: chat.name?.slice(0, 190) || null,
    isGroup: !!chat.isGroup,
    isArchived: !!chat.archived,
    isPinned: !!chat.pinned,
    isMuted: !!chat.isMuted,
    isReadOnly: !!chat.isReadOnly,
    unreadCount: Math.max(0, chat.unreadCount ?? 0),
    ...(group
      ? {
          groupDescription: (group as any).description ?? null,
          groupOwner: group.owner?._serialized ?? null,
          groupCreatedAt: group.createdAt ? new Date(group.createdAt) : null,
        }
      : {}),
    ...(chat.timestamp ? { lastMessageAt: new Date(chat.timestamp * 1000) } : {}),
    ...(last ? { lastMessagePreview: previewOf(String(last.type), last.body), lastMessageFromMe: !!last.fromMe } : {}),
    ...(extra.profilePicUrl !== undefined ? { profilePicUrl: extra.profilePicUrl } : {}),
  };
  const row = await prisma().chat.upsert({
    where: { accountId_waChatId: { accountId, waChatId } },
    create: { accountId, waChatId, ...data },
    update: data,
  });
  chatIdCache.set(cacheKey(accountId, waChatId), row.id);
  if (group && Array.isArray(group.participants)) await upsertParticipants(accountId, row.id, group.participants);
  return row;
}

export async function upsertParticipants(accountId: string, chatId: string, participants: WaGroupChat['participants']) {
  const ids = participants.map((p) => p.id._serialized);
  await prisma().$transaction([
    prisma().groupParticipant.deleteMany({ where: { chatId, waId: { notIn: ids.length ? ids : ['__none__'] } } }),
    ...participants.map((p) =>
      prisma().groupParticipant.upsert({
        where: { chatId_waId: { chatId, waId: p.id._serialized } },
        create: { chatId, accountId, waId: p.id._serialized, isAdmin: !!p.isAdmin, isSuperAdmin: !!p.isSuperAdmin },
        update: { isAdmin: !!p.isAdmin, isSuperAdmin: !!p.isSuperAdmin },
      }),
    ),
  ]);
}

async function ensureChatId(accountId: string, waChatId: string, msg?: WaMessage): Promise<string | null> {
  if (isStatusBroadcast(waChatId)) return null;
  const k = cacheKey(accountId, waChatId);
  const cached = chatIdCache.get(k);
  if (cached) return cached;
  const existing = await prisma().chat.findUnique({ where: { accountId_waChatId: { accountId, waChatId } }, select: { id: true } });
  if (existing) {
    chatIdCache.set(k, existing.id);
    return existing.id;
  }
  if (msg) {
    try {
      const chat = await msg.getChat();
      const row = await upsertChat(accountId, chat);
      if (row) return row.id;
    } catch (e) {
      log.debug('getChat failed; creating minimal chat', { accountId, error: errMsg(e) });
    }
  }
  const row = await prisma().chat.upsert({
    where: { accountId_waChatId: { accountId, waChatId } },
    create: { accountId, waChatId, isGroup: waChatId.endsWith('@g.us') },
    update: {},
  });
  chatIdCache.set(k, row.id);
  return row.id;
}

export interface UpsertResult {
  message: Message;
  created: boolean;
}

/**
 * Insert or update a message. Duplicates are prevented by the (account_id, wa_message_id) unique key,
 * so repeated events and re-syncs are idempotent.
 */
export async function upsertMessage(
  accountId: string,
  msg: WaMessage,
  opts: { live?: boolean; downloadMedia?: boolean; sentByUserId?: string | null; sentVia?: string | null } = {},
): Promise<UpsertResult | null> {
  const m = mapMessage(msg);
  if (IGNORED_TYPES.has(m.type) || isStatusBroadcast(m.waChatId)) return null;
  const chatId = await ensureChatId(accountId, m.waChatId, msg);
  if (!chatId) return null;

  let quotedWaMessageId: string | null = null;
  let quotedBody: string | null = null;
  if (msg.hasQuotedMsg) {
    try {
      const q = await msg.getQuotedMessage();
      if (q) {
        quotedWaMessageId = q.id._serialized;
        quotedBody = previewOf(String(q.type), MEDIA_TYPES.has(String(q.type)) ? ((q as any)._data?.caption ?? '') : q.body).slice(0, 500);
      }
    } catch {
      /* quoted message unavailable */
    }
  }

  const existing = await prisma().message.findUnique({ where: { accountId_waMessageId: { accountId, waMessageId: m.waMessageId } } });
  let message: Message;
  let created = false;
  if (existing) {
    message = await prisma().message.update({
      where: { id: existing.id },
      data: {
        ack: m.ack,
        status: existing.direction === 'OUTBOUND' ? m.status : existing.status,
        ...(m.isEdited && m.body !== existing.body ? { body: m.body, isEdited: true, editedAt: new Date() } : {}),
        ...(m.type === 'revoked' ? { isDeleted: true, deletedAt: existing.deletedAt ?? new Date() } : {}),
        ...(opts.sentByUserId ? { sentByUserId: opts.sentByUserId } : {}),
        ...(opts.sentVia ? { sentVia: opts.sentVia } : {}),
      },
    });
  } else {
    try {
      message = await prisma().message.create({
        data: {
          accountId,
          chatId,
          waMessageId: m.waMessageId,
          direction: m.direction,
          type: m.type,
          body: m.body,
          senderWaId: m.senderWaId,
          senderName: m.senderName,
          status: m.status,
          ack: m.ack,
          timestamp: m.timestamp,
          hasMedia: m.hasMedia,
          quotedWaMessageId,
          quotedBody,
          isForwarded: m.isForwarded,
          isEdited: m.isEdited,
          isDeleted: m.type === 'revoked',
          locationLat: m.locationLat,
          locationLng: m.locationLng,
          locationName: m.locationName,
          sentByUserId: opts.sentByUserId ?? null,
          sentVia: opts.sentVia ?? (m.direction === 'OUTBOUND' ? 'whatsapp' : null),
        },
      });
      created = true;
    } catch (e: any) {
      // Unique violation from a concurrent event for the same message — treat as existing.
      if (e?.code === 'P2002') {
        const row = await prisma().message.findUnique({ where: { accountId_waMessageId: { accountId, waMessageId: m.waMessageId } } });
        if (!row) throw e;
        return { message: row, created: false };
      }
      throw e;
    }
    if (m.hasMedia) {
      await prisma().messageAttachment.create({
        data: {
          accountId,
          messageId: message.id,
          mimeType: (msg as any)._data?.mimetype ?? 'application/octet-stream',
          originalFilename: documentFilename(msg),
          sizeBytes: (msg as any)._data?.size ?? null,
          state: 'NOT_DOWNLOADED',
          source: 'whatsapp',
        },
      });
    }
    // Keep chat summary and contact interaction timestamps current.
    const chat = await prisma().chat.findUnique({ where: { id: chatId }, select: { lastMessageAt: true } });
    if (!chat?.lastMessageAt || chat.lastMessageAt <= m.timestamp) {
      await prisma().chat.update({
        where: { id: chatId },
        data: {
          lastMessageAt: m.timestamp,
          lastMessagePreview: previewOf(m.type, m.body),
          lastMessageFromMe: m.direction === 'OUTBOUND',
          ...(opts.live && m.direction === 'INBOUND' ? { unreadCount: { increment: 1 } } : {}),
          ...(opts.live && m.direction === 'OUTBOUND' ? { unreadCount: 0 } : {}),
        },
      });
    }
    await prisma().contact.updateMany({ where: { accountId, waId: m.waChatId }, data: { lastInteractionAt: m.timestamp } });
  }

  if (created && m.hasMedia && opts.downloadMedia) {
    void downloadMessageMedia(accountId, message.id, msg).catch((e) => log.warn('Media download failed', { accountId, error: errMsg(e) }));
  }
  return { message, created };
}

/** Download media for a stored message (automatic or on demand). */
export async function downloadMessageMedia(accountId: string, messageDbId: string, msg: WaMessage) {
  const att = await prisma().messageAttachment.findFirst({ where: { messageId: messageDbId, accountId } });
  const declaredSize = (msg as any)._data?.size as number | undefined;
  if (declaredSize && declaredSize > maxBytes()) {
    if (att) await prisma().messageAttachment.update({ where: { id: att.id }, data: { state: 'NOT_DOWNLOADED' } });
    return null;
  }
  const media = await msg.downloadMedia();
  if (!media?.data) {
    if (att) await prisma().messageAttachment.update({ where: { id: att.id }, data: { state: 'FAILED' } });
    return null;
  }
  const buffer = Buffer.from(media.data, 'base64');
  if (buffer.length > maxBytes()) {
    if (att) await prisma().messageAttachment.update({ where: { id: att.id }, data: { state: 'NOT_DOWNLOADED', sizeBytes: buffer.length } });
    return null;
  }
  const mime = (media.mimetype || 'application/octet-stream').split(';')[0];
  const stored = await storeBuffer({
    accountId,
    buffer,
    mimeType: mime,
    filename: media.filename ?? att?.originalFilename ?? null,
    source: 'whatsapp',
    messageId: messageDbId,
    attachmentId: att?.id,
  });
  const full = await prisma().message.findUnique({ where: { id: messageDbId }, include: { attachments: true, reactions: true } });
  if (full) bus.publish({ type: 'message.upsert', accountId, data: { message: serializeMessage(full) } });
  return stored;
}

export async function applyAck(accountId: string, msg: WaMessage, ack: number) {
  const waMessageId = msg.id._serialized;
  const status = ackToStatus(ack, !!msg.fromMe);
  const res = await prisma().message.updateMany({ where: { accountId, waMessageId, direction: 'OUTBOUND' }, data: { ack, status } });
  return res.count > 0 ? { waMessageId, status } : null;
}

export async function applyEdit(accountId: string, msg: WaMessage, newBody: string) {
  await prisma().message.updateMany({
    where: { accountId, waMessageId: msg.id._serialized },
    data: { body: newBody, isEdited: true, editedAt: new Date() },
  });
}

export async function applyRevoke(accountId: string, waMessageId: string) {
  await prisma().message.updateMany({ where: { accountId, waMessageId }, data: { isDeleted: true, deletedAt: new Date() } });
}

export async function applyReaction(accountId: string, r: { msgId: { _serialized: string }; senderId: string; reaction: string; timestamp: number }) {
  const message = await prisma().message.findUnique({ where: { accountId_waMessageId: { accountId, waMessageId: r.msgId._serialized } } });
  if (!message) return null;
  if (!r.reaction) {
    await prisma().messageReaction.deleteMany({ where: { messageId: message.id, senderWaId: r.senderId } });
  } else {
    await prisma().messageReaction.upsert({
      where: { messageId_senderWaId: { messageId: message.id, senderWaId: r.senderId } },
      create: { messageId: message.id, accountId, senderWaId: r.senderId, emoji: r.reaction.slice(0, 30), timestamp: new Date((r.timestamp || Date.now() / 1000) * 1000) },
      update: { emoji: r.reaction.slice(0, 30), timestamp: new Date((r.timestamp || Date.now() / 1000) * 1000) },
    });
  }
  return prisma().message.findUnique({ where: { id: message.id }, include: { attachments: true, reactions: true } });
}

export async function upsertContact(accountId: string, c: WaContact): Promise<void> {
  const waId = c.id._serialized;
  const data = {
    phoneNumber: c.number || waIdToPhone(waId),
    displayName: (c.name || c.shortName || null)?.slice(0, 190) ?? null,
    profileName: c.pushname?.slice(0, 190) || null,
    isBusiness: !!c.isBusiness,
    isEnterprise: !!c.isEnterprise,
    isMyContact: !!c.isMyContact,
    isGroup: !!c.isGroup,
    isBlocked: !!c.isBlocked,
  };
  await prisma().contact.upsert({ where: { accountId_waId: { accountId, waId } }, create: { accountId, waId, ...data }, update: data });
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<null>((r) => (t = setTimeout(() => r(null), ms)))]).finally(() => clearTimeout(t));
}

/**
 * Initial synchronisation after a client becomes ready. Limits come from settings. Only what
 * WhatsApp Web has available locally can be synchronised; chats are flagged FULL or PARTIAL.
 */
export async function initialSync(accountId: string, client: WaClient, isCurrent: () => boolean) {
  const s = settings();
  const started = Date.now();
  const chats = (await client.getChats()).filter((c) => !isStatusBroadcast(c.id._serialized));
  chats.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const top = chats.slice(0, s.initialSyncChats);
  bus.publish({ type: 'sync.progress', accountId, data: { phase: 'chats', total: chats.length } });

  // Chat metadata for every chat (cheap — already in WhatsApp Web memory).
  for (const chat of chats) {
    if (!isCurrent()) return;
    try {
      await upsertChat(accountId, chat);
    } catch (e) {
      log.warn('Chat upsert failed', { accountId, error: errMsg(e) });
    }
  }

  // Recent messages for the most recent chats.
  let done = 0;
  for (const chat of top) {
    if (!isCurrent()) return;
    try {
      const limit = s.initialSyncMessagesPerChat;
      const msgs = limit > 0 ? ((await withTimeout(chat.fetchMessages({ limit }), 30000)) ?? []) : [];
      for (const m of msgs) await upsertMessage(accountId, m, { live: false, downloadMedia: false });
      const profilePicUrl = await withTimeout(client.getProfilePicUrl(chat.id._serialized).catch(() => null), 8000);
      const row = await upsertChat(accountId, chat, { profilePicUrl: profilePicUrl ?? null });
      if (row) {
        const count = await prisma().message.count({ where: { chatId: row.id } });
        await prisma().chat.update({
          where: { id: row.id },
          data: { syncState: limit > 0 && msgs.length < limit ? 'FULL' : 'PARTIAL', syncedMessageCount: count, lastSyncedAt: new Date() },
        });
      }
    } catch (e) {
      log.warn('Message sync failed for chat', { accountId, error: errMsg(e) });
    }
    done++;
    if (done % 5 === 0) bus.publish({ type: 'sync.progress', accountId, data: { phase: 'messages', done, total: top.length } });
  }

  // Contacts: keep saved contacts and anyone we have a chat with.
  try {
    const contacts = await client.getContacts();
    const chatIds = new Set(chats.map((c) => c.id._serialized));
    const relevant = contacts.filter((c) => !c.isMe && (c.isMyContact || chatIds.has(c.id._serialized)) && (c.isUser || c.isGroup));
    for (const c of relevant) {
      if (!isCurrent()) return;
      await upsertContact(accountId, c).catch((e) => log.debug('Contact upsert failed', { error: errMsg(e) }));
    }
  } catch (e) {
    log.warn('Contact sync failed', { accountId, error: errMsg(e) });
  }

  await prisma().whatsappAccount.update({ where: { id: accountId }, data: { lastSyncAt: new Date() } });
  bus.publish({ type: 'sync.progress', accountId, data: { phase: 'done', chats: chats.length, syncedChats: top.length, ms: Date.now() - started } });
  log.info('Initial sync complete', { accountId, chats: chats.length, syncedChats: top.length, ms: Date.now() - started });
}

/** Load older history for a chat from WhatsApp Web, beyond what is stored locally. */
export async function backfillChat(accountId: string, client: WaClient, chatRow: Chat, extra: number) {
  const chat = await client.getChatById(chatRow.waChatId);
  const current = await prisma().message.count({ where: { chatId: chatRow.id } });
  const limit = Math.min(current + extra, 5000);
  const msgs = await chat.fetchMessages({ limit });
  let added = 0;
  for (const m of msgs) {
    const r = await upsertMessage(accountId, m, { live: false, downloadMedia: false });
    if (r?.created) added++;
  }
  const count = await prisma().message.count({ where: { chatId: chatRow.id } });
  const syncState = msgs.length < limit ? 'FULL' : 'PARTIAL';
  const updated = await prisma().chat.update({ where: { id: chatRow.id }, data: { syncState, syncedMessageCount: count, lastSyncedAt: new Date() } });
  bus.publish({ type: 'chat.upsert', accountId, data: { chat: serializeChat(updated) } });
  return { added, syncState };
}
