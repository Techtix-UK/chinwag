import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { notFound, validationError } from '../../lib/errors.js';
import { normaliseInternational, formatInternational } from '../../lib/phone.js';
import * as conv from '../../services/conversations.js';
import { audit } from '../../services/audit.js';
import { assertCan } from '../../services/permissions.js';
import { sessionManager } from '../../whatsapp/manager.js';
import { page, pagination, route } from '../route.js';

const acc = z.object({ accountId: z.string().min(1).max(40) });
const accContact = acc.extend({ contactId: z.string().min(1).max(160) });

export function contactRoutes(r: Router) {
  route(r, {
    method: 'get', path: '/contacts', summary: 'List contacts across authorised accounts', tags: ['Contacts'], capability: 'contacts:read',
    query: z.object({ account_id: z.string().max(40).optional(), q: z.string().max(120).optional(), tag: z.string().max(64).optional(), ...pagination }),
    handler: async ({ principal, query }) => {
      const res = await conv.listContacts(principal, { accountId: query.account_id, q: query.q, tag: query.tag, limit: query.limit, offset: query.offset });
      return page(res.items, res.total, query.limit, query.offset);
    },
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/contacts', summary: 'List contacts', tags: ['Contacts'], params: acc,
    query: z.object({ tag: z.string().max(64).optional(), ...pagination }),
    handler: async ({ principal, params, query }) => {
      const res = await conv.listContacts(principal, { accountId: params.accountId, tag: query.tag, limit: query.limit, offset: query.offset });
      return page(res.items, res.total, query.limit, query.offset);
    },
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/contacts/search', summary: 'Search contacts by name, telephone number or tag', tags: ['Contacts'], params: acc,
    query: z.object({ q: z.string().min(1).max(120), ...pagination }),
    handler: async ({ principal, params, query }) => {
      const res = await conv.listContacts(principal, { accountId: params.accountId, q: query.q, limit: query.limit, offset: query.offset });
      return page(res.items, res.total, query.limit, query.offset);
    },
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/contacts/check', summary: 'Check whether a number can be resolved on WhatsApp', tags: ['Contacts'], params: acc,
    query: z.object({ phone_number: z.string().min(6).max(32) }),
    handler: async ({ principal, params, query }) => {
      assertCan(principal, 'contacts:read', params.accountId);
      const digits = normaliseInternational(query.phone_number);
      if (!digits) throw validationError('Use international format, e.g. +44 7700 900123');
      const wid = await sessionManager().requireClient(params.accountId).getNumberId(digits).catch(() => null);
      return { phone_number: formatInternational(digits), on_whatsapp: !!wid, chat_id: wid?._serialized ?? null };
    },
  });

  route(r, {
    method: 'get', path: '/accounts/:accountId/contacts/:contactId', summary: 'Get a contact', tags: ['Contacts'], params: accContact,
    handler: async ({ principal, params }) => conv.getContact(principal, params.accountId, params.contactId),
  });

  route(r, {
    method: 'put', path: '/accounts/:accountId/contacts/:contactId/tags', summary: 'Replace contact tags', tags: ['Contacts'], params: accContact,
    body: z.object({ tags: z.array(z.string().min(1).max(64).regex(/^[\p{L}\p{N} _.-]+$/u)).max(30) }),
    handler: async ({ principal, params, body }) => {
      assertCan(principal, 'contacts:write', params.accountId);
      const c = await prisma().contact.findFirst({ where: { accountId: params.accountId, OR: [{ id: params.contactId }, { waId: params.contactId }] } });
      if (!c) throw notFound('Contact');
      const tags = [...new Set(body.tags.map((t) => t.trim().toLowerCase()))];
      await prisma().$transaction([prisma().contactTag.deleteMany({ where: { contactId: c.id } }), prisma().contactTag.createMany({ data: tags.map((tag) => ({ contactId: c.id, tag })) })]);
      await audit({ action: 'contact.tags_updated', actor: principal, accountId: params.accountId, metadata: { contactId: c.id, count: tags.length } });
      return conv.getContact(principal, params.accountId, c.id);
    },
  });

  route(r, {
    method: 'post', path: '/accounts/:accountId/contacts/:contactId/notes', summary: 'Add a note to a contact', tags: ['Contacts'], params: accContact, status: 201,
    body: z.object({ body: z.string().min(1).max(5000) }),
    handler: async ({ principal, params, body }) => {
      assertCan(principal, 'contacts:write', params.accountId);
      const c = await prisma().contact.findFirst({ where: { accountId: params.accountId, OR: [{ id: params.contactId }, { waId: params.contactId }] } });
      if (!c) throw notFound('Contact');
      const n = await prisma().contactNote.create({ data: { contactId: c.id, body: body.body, authorId: principal.type === 'user' ? principal.id : null } });
      await audit({ action: 'contact.note_added', actor: principal, accountId: params.accountId, metadata: { contactId: c.id } });
      return { id: n.id, body: n.body, created_at: n.createdAt };
    },
  });

  route(r, {
    method: 'delete', path: '/accounts/:accountId/contacts/:contactId/notes/:noteId', summary: 'Delete a contact note', tags: ['Contacts'], params: accContact.extend({ noteId: z.string().max(40) }),
    handler: async ({ principal, params }) => {
      assertCan(principal, 'contacts:write', params.accountId);
      await prisma().contactNote.deleteMany({ where: { id: params.noteId, contact: { accountId: params.accountId } } });
      return undefined;
    },
  });
}
