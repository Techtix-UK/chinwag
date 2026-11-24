import { prisma } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { notFound } from '../lib/errors.js';
import { digitsOnly } from '../lib/phone.js';
import { accountFilter, assertCan, type Principal } from './permissions.js';
import { serializeChat, serializeContact, serializeMessage, serializeParticipant } from './serializers.js';

export interface ChatListQuery {
  accountId?: string;
  filter?: 'all' | 'unread' | 'individuals' | 'groups' | 'archived';
  q?: string;
  limit: number;
  offset: number;
}

function accountWhere(p: Principal, cap: 'chats:read' | 'messages:read' | 'contacts:read' | 'groups:read', accountId?: string) {
  if (accountId) {
    assertCan(p, cap, accountId);
    return { accountId };
  }
  const f = accountFilter(p, cap);
  return f ? { accountId: f } : {};
}

export async function listChats(p: Principal, q: ChatListQuery) {
  const where: Prisma.ChatWhereInput = { ...accountWhere(p, 'chats:read', q.accountId) };
  switch (q.filter) {
    case 'unread':
      where.unreadCount = { gt: 0 };
      where.isArchived = false;
      break;
    case 'individuals':
      where.isGroup = false;
      where.isArchived = false;
      break;
    case 'groups':
      where.isGroup = true;
      where.isArchived = false;
      break;
    case 'archived':
      where.isArchived = true;
      break;
    default:
      where.isArchived = false;
  }
  if (q.q?.trim()) {
    const term = q.q.trim();
    const digits = digitsOnly(term);
    const or: Prisma.ChatWhereInput[] = [{ name: { contains: term } }, { waChatId: { contains: term } }];
    if (digits.length >= 4) or.push({ waChatId: { contains: digits } });
    // Contacts whose name/number matches (chat names can be empty for unsaved numbers)
    const contacts = await prisma().contact.findMany({
      where: { ...accountWhere(p, 'chats:read', q.accountId), OR: [{ displayName: { contains: term } }, { profileName: { contains: term } }, ...(digits.length >= 4 ? [{ phoneNumber: { contains: digits } }] : [])] },
      select: { waId: true, accountId: true },
      take: 200,
    });
    for (const c of contacts) or.push({ accountId: c.accountId, waChatId: c.waId });
    // Message content (locally synchronised only)
    const msgChats = await prisma().message.findMany({
      where: { ...accountWhere(p, 'messages:read', q.accountId), body: { contains: term } },
      select: { chatId: true },
      distinct: ['chatId'],
      take: 200,
    }).catch(() => [] as { chatId: string }[]);
    if (msgChats.length) or.push({ id: { in: msgChats.map((m) => m.chatId) } });
    where.OR = or;
  }
  const [rows, total] = await Promise.all([
    prisma().chat.findMany({ where, orderBy: [{ isPinned: 'desc' }, { lastMessageAt: { sort: 'desc', nulls: 'last' } }], take: q.limit, skip: q.offset }),
    prisma().chat.count({ where }),
  ]);
  return { items: rows.map(serializeChat), total };
}

export async function getChat(p: Principal, accountId: string, chatId: string) {
  assertCan(p, 'chats:read', accountId);
  const chat = await findChat(accountId, chatId);
  if (!chat) throw notFound('Chat');
  return chat;
}

/** Accepts either the internal chat id or the WhatsApp chat id (e.g. 447700900123@c.us). */
export async function findChat(accountId: string, chatId: string) {
  if (chatId.includes('@')) return prisma().chat.findUnique({ where: { accountId_waChatId: { accountId, waChatId: chatId } } });
  return prisma().chat.findFirst({ where: { id: chatId, accountId } });
}

export async function chatDetail(p: Principal, accountId: string, chatId: string) {
  const chat = await getChat(p, accountId, chatId);
  const out: Record<string, unknown> = serializeChat(chat);
  if (chat.isGroup) out.participant_count = await prisma().groupParticipant.count({ where: { chatId: chat.id } });
  else {
    const contact = await prisma().contact.findUnique({ where: { accountId_waId: { accountId, waId: chat.waChatId } }, include: { tags: true } });
    out.contact = contact ? serializeContact(contact) : null;
  }
  return out;
}

export async function listMessages(p: Principal, accountId: string, chatId: string, opts: { limit: number; before?: string; after?: string }) {
  assertCan(p, 'messages:read', accountId);
  const chat = await getChat(p, accountId, chatId);
  const where: Prisma.MessageWhereInput = { chatId: chat.id };
  if (opts.before) {
    const ref = await prisma().message.findFirst({ where: { id: opts.before, chatId: chat.id } });
    if (ref) where.OR = [{ timestamp: { lt: ref.timestamp } }, { timestamp: ref.timestamp, id: { lt: ref.id } }];
  }
  if (opts.after) {
    const ref = await prisma().message.findFirst({ where: { id: opts.after, chatId: chat.id } });
    if (ref) where.OR = [{ timestamp: { gt: ref.timestamp } }, { timestamp: ref.timestamp, id: { gt: ref.id } }];
  }
  const rows = await prisma().message.findMany({
    where,
    orderBy: opts.after ? [{ timestamp: 'asc' }, { id: 'asc' }] : [{ timestamp: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
    include: { attachments: true, reactions: true },
  });
  const hasMore = rows.length > opts.limit;
  const page = rows.slice(0, opts.limit);
  const ordered = opts.after ? page : page.reverse();
  return {
    chat,
    items: ordered.map(serializeMessage),
    has_more_local: hasMore,
    next_before: !opts.after && ordered.length ? ordered[0].id : null,
    sync_state: chat.syncState.toLowerCase(),
  };
}

export async function searchMessages(p: Principal, q: { accountId?: string; query: string; chatId?: string; limit: number; offset: number; from?: Date; to?: Date }) {
  const where: Prisma.MessageWhereInput = { ...accountWhere(p, 'messages:read', q.accountId), body: { contains: q.query } };
  if (q.chatId && q.accountId) {
    const chat = await findChat(q.accountId, q.chatId);
    if (!chat) throw notFound('Chat');
    where.chatId = chat.id;
  }
  if (q.from || q.to) where.timestamp = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
  const [rows, total] = await Promise.all([
    prisma().message.findMany({ where, orderBy: { timestamp: 'desc' }, take: q.limit, skip: q.offset, include: { chat: true, attachments: true } }),
    prisma().message.count({ where }),
  ]);
  return {
    items: rows.map((m) => ({ ...serializeMessage(m), chat: { id: m.chat.id, wa_chat_id: m.chat.waChatId, name: m.chat.name, is_group: m.chat.isGroup } })),
    total,
  };
}

export async function recentMessages(p: Principal, q: { accountId?: string; limit: number; direction?: 'inbound' | 'outbound'; since?: Date }) {
  const where: Prisma.MessageWhereInput = { ...accountWhere(p, 'messages:read', q.accountId) };
  if (q.direction) where.direction = q.direction === 'inbound' ? 'INBOUND' : 'OUTBOUND';
  if (q.since) where.timestamp = { gte: q.since };
  const rows = await prisma().message.findMany({ where, orderBy: { timestamp: 'desc' }, take: q.limit, include: { chat: true, attachments: true } });
  return rows.map((m) => ({ ...serializeMessage(m), chat: { id: m.chat.id, wa_chat_id: m.chat.waChatId, name: m.chat.name, is_group: m.chat.isGroup } }));
}

export interface ContactQuery {
  accountId?: string;
  q?: string;
  tag?: string;
  limit: number;
  offset: number;
}

export async function listContacts(p: Principal, q: ContactQuery) {
  const where: Prisma.ContactWhereInput = { ...accountWhere(p, 'contacts:read', q.accountId), isGroup: false };
  if (q.q?.trim()) {
    const term = q.q.trim();
    const digits = digitsOnly(term);
    where.OR = [
      { displayName: { contains: term } },
      { profileName: { contains: term } },
      ...(digits.length >= 3 ? [{ phoneNumber: { contains: digits } }] : []),
      { tags: { some: { tag: { contains: term.toLowerCase() } } } },
    ];
  }
  if (q.tag) where.tags = { some: { tag: q.tag.toLowerCase() } };
  const [rows, total] = await Promise.all([
    prisma().contact.findMany({ where, orderBy: [{ lastInteractionAt: { sort: 'desc', nulls: 'last' } }, { displayName: 'asc' }], take: q.limit, skip: q.offset, include: { tags: true } }),
    prisma().contact.count({ where }),
  ]);
  return { items: rows.map(serializeContact), total };
}

export async function getContact(p: Principal, accountId: string, contactId: string) {
  assertCan(p, 'contacts:read', accountId);
  const where = contactId.includes('@') ? { accountId_waId: { accountId, waId: contactId } } : { id: contactId };
  const c = await prisma().contact.findUnique({ where: where as any, include: { tags: true, notes: { orderBy: { createdAt: 'desc' } } } });
  if (!c || c.accountId !== accountId) throw notFound('Contact');
  const chat = await prisma().chat.findUnique({ where: { accountId_waChatId: { accountId, waChatId: c.waId } } });
  return { ...serializeContact(c), chat: chat ? serializeChat(chat) : null };
}

export async function listGroups(p: Principal, q: { accountId?: string; q?: string; limit: number; offset: number }) {
  const where: Prisma.ChatWhereInput = { ...accountWhere(p, 'groups:read', q.accountId), isGroup: true };
  if (q.q) where.name = { contains: q.q };
  const [rows, total] = await Promise.all([
    prisma().chat.findMany({ where, orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } }, take: q.limit, skip: q.offset, include: { _count: { select: { participants: true } } } }),
    prisma().chat.count({ where }),
  ]);
  return { items: rows.map((c) => ({ ...serializeChat(c), participant_count: c._count.participants })), total };
}

export async function groupParticipants(p: Principal, accountId: string, chatId: string) {
  assertCan(p, 'groups:read', accountId);
  const chat = await findChat(accountId, chatId);
  if (!chat || !chat.isGroup) throw notFound('Group');
  const parts = await prisma().groupParticipant.findMany({ where: { chatId: chat.id }, orderBy: [{ isSuperAdmin: 'desc' }, { isAdmin: 'desc' }] });
  const contacts = await prisma().contact.findMany({ where: { accountId, waId: { in: parts.map((x) => x.waId) } } });
  const byId = new Map(contacts.map((c) => [c.waId, c]));
  return { chat, participants: parts.map((x) => serializeParticipant({ ...x, contact: byId.get(x.waId) ?? null })) };
}
