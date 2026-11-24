import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { forbidden } from '../../lib/errors.js';
import * as conv from '../../services/conversations.js';
import { assertCan, isIntegration } from '../../services/permissions.js';
import { audit } from '../../services/audit.js';
import { serializeChat } from '../../services/serializers.js';
import { sessionManager } from '../../whatsapp/manager.js';
import { backfillChat } from '../../whatsapp/sync.js';
import { page, pagination, route } from '../route.js';

const acc = z.object({ accountId: z.string().min(1).max(40) });
const accChat = acc.extend({ chatId: z.string().min(1).max(160) });

export function chatRoutes(r: Router) {
  route(r, {
    method: 'get', path: '/chats', summary: 'List conversations across authorised accounts', tags: ['Conversations'], capability: 'chats:read',
    query: z.object({ account_id: z.string().max(40).optional(), filter: z.enum(['all', 'unread', 'individuals', 'groups', 'archived']).default('all'), q: z.string().max(120).optional(), ...pagination }),
    handler: async ({ principal, query }) => {
      const res = await conv.listChats(principal, { accountId: query.account_id, filter: query.filter, q: query.q, limit: query.limit, offset: query.offset });
      return page(res.items, res.total, query.limit, query.offset);
    },
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/chats', summary: 'List conversations', tags: ['Conversations'], params: acc,
    query: z.object({ filter: z.enum(['all', 'unread', 'individuals', 'groups', 'archived']).default('all'), q: z.string().max(120).optional(), ...pagination }),
    handler: async ({ principal, params, query }) => {
      const res = await conv.listChats(principal, { accountId: params.accountId, filter: query.filter, q: query.q, limit: query.limit, offset: query.offset });
      return page(res.items, res.total, query.limit, query.offset);
    },
  });

  // Registered before /chats/:chatId so "unread" is not treated as a chat id.
  route(r, {
    method: 'get', path: '/accounts/:accountId/chats/unread', summary: 'List unread conversations', tags: ['Conversations'], params: acc, query: z.object(pagination),
    handler: async ({ principal, params, query }) => {
      const res = await conv.listChats(principal, { accountId: params.accountId, filter: 'unread', limit: query.limit, offset: query.offset });
      return page(res.items, res.total, query.limit, query.offset);
    },
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/chats/:chatId', summary: 'Get a conversation', tags: ['Conversations'], params: accChat,
    handler: async ({ principal, params, req }) => {
      const detail = await conv.chatDetail(principal, params.accountId, params.chatId);
      if (req.principal?.type === 'user') {
        const draft = await prisma().messageDraft.findUnique({ where: { userId_chatId: { userId: req.principal.id, chatId: detail.id as string } } });
        detail.draft = draft?.body ?? null;
      }
      return detail;
    },
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/chats/:chatId/messages', summary: 'List messages in a conversation (newest page first, chronological order)', tags: ['Conversations'], params: accChat,
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.string().max(40).optional(), after: z.string().max(40).optional() }),
    handler: async ({ principal, params, query }) => {
      const res = await conv.listMessages(principal, params.accountId, params.chatId, query);
      return { items: res.items, has_more_local: res.has_more_local, next_before: res.next_before, sync_state: res.sync_state, chat: serializeChat(res.chat) };
    },
  });

  route(r, {
    method: 'post', path: '/accounts/:accountId/chats/:chatId/read', summary: 'Mark a conversation as read', tags: ['Conversations'], params: accChat,
    handler: async ({ principal, params }) => {
      assertCan(principal, 'messages:send', params.accountId);
      if (isIntegration(principal) && principal.approvalPolicy === 'READ_ONLY') throw forbidden('This integration is read-only');
      const chat = await conv.getChat(principal, params.accountId, params.chatId);
      if (sessionManager().isReady(params.accountId)) await sessionManager().requireClient(params.accountId).sendSeen(chat.waChatId).catch(() => false);
      const updated = await prisma().chat.update({ where: { id: chat.id }, data: { unreadCount: 0 } });
      return serializeChat(updated);
    },
  });

  route(r, {
    method: 'post', path: '/accounts/:accountId/chats/:chatId/backfill', summary: 'Load older history from WhatsApp Web', tags: ['Conversations'], params: accChat,
    body: z.object({ count: z.number().int().min(10).max(500).default(100) }),
    handler: async ({ principal, params, body }) => {
      assertCan(principal, 'messages:read', params.accountId);
      const chat = await conv.getChat(principal, params.accountId, params.chatId);
      const client = sessionManager().requireClient(params.accountId);
      const res = await backfillChat(params.accountId, client, chat, body.count);
      await audit({ action: 'chat.backfilled', actor: principal, accountId: params.accountId, metadata: { chatId: chat.id, added: res.added } });
      return { added: res.added, sync_state: res.syncState.toLowerCase() };
    },
  });

  route(r, {
    method: 'put', path: '/accounts/:accountId/chats/:chatId/draft', summary: 'Save a local draft', tags: ['Conversations'], auth: 'session', internal: true, params: accChat,
    body: z.object({ body: z.string().max(4096) }),
    handler: async ({ principal, params, body }) => {
      const chat = await conv.getChat(principal, params.accountId, params.chatId);
      if (!body.body.trim()) await prisma().messageDraft.deleteMany({ where: { userId: principal.id, chatId: chat.id } });
      else await prisma().messageDraft.upsert({ where: { userId_chatId: { userId: principal.id, chatId: chat.id } }, create: { userId: principal.id, chatId: chat.id, body: body.body }, update: { body: body.body } });
      return { ok: true };
    },
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/messages/search', summary: 'Search locally synchronised messages', tags: ['Conversations'], params: acc,
    query: z.object({ q: z.string().min(1).max(200), chat_id: z.string().max(160).optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), ...pagination }),
    handler: async ({ principal, params, query }) => {
      const res = await conv.searchMessages(principal, { accountId: params.accountId, query: query.q, chatId: query.chat_id, from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined, limit: query.limit, offset: query.offset });
      return page(res.items, res.total, query.limit, query.offset);
    },
  });

  route(r, {
    method: 'get', path: '/messages/search', summary: 'Search messages across authorised accounts', tags: ['Conversations'], capability: 'messages:read',
    query: z.object({ q: z.string().min(1).max(200), account_id: z.string().max(40).optional(), ...pagination }),
    handler: async ({ principal, query }) => {
      const res = await conv.searchMessages(principal, { accountId: query.account_id, query: query.q, limit: query.limit, offset: query.offset });
      return page(res.items, res.total, query.limit, query.offset);
    },
  });

  route(r, {
    method: 'get', path: '/messages/recent', summary: 'Recent messages across authorised accounts', tags: ['Conversations'], capability: 'messages:read',
    query: z.object({ account_id: z.string().max(40).optional(), direction: z.enum(['inbound', 'outbound']).optional(), since: z.iso.datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
    handler: async ({ principal, query }) => conv.recentMessages(principal, { accountId: query.account_id, direction: query.direction, since: query.since ? new Date(query.since) : undefined, limit: query.limit }),
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/groups', summary: 'List groups', tags: ['Groups'], params: acc,
    query: z.object({ q: z.string().max(120).optional(), ...pagination }),
    handler: async ({ principal, params, query }) => {
      const res = await conv.listGroups(principal, { accountId: params.accountId, q: query.q, limit: query.limit, offset: query.offset });
      return page(res.items, res.total, query.limit, query.offset);
    },
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/groups/:chatId/participants', summary: 'List group participants', tags: ['Groups'], params: accChat,
    handler: async ({ principal, params }) => (await conv.groupParticipants(principal, params.accountId, params.chatId)).participants,
  });
}
