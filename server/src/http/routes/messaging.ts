import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { AppError, notFound, tooLarge, validationError } from '../../lib/errors.js';
import { assertCan, type Principal } from '../../services/permissions.js';
import { storeFromUrl, storeUpload, maxBytes, attachmentStream, inlineSafe } from '../../services/media.js';
import { withIdempotency } from '../../services/idempotency.js';
import { buildMediaPayload, requestSend, resolveRecipient, type OutboundPayload } from '../../services/outbound.js';
import { serializeAttachment } from '../../services/serializers.js';
import { audit } from '../../services/audit.js';
import { sessionManager } from '../../whatsapp/manager.js';
import { downloadMessageMedia } from '../../whatsapp/sync.js';
import { route } from '../route.js';

const acc = z.object({ accountId: z.string().min(1).max(40) });
const recipient = z.object({
  chat_id: z.string().max(160).optional(),
  phone_number: z.string().max(32).optional(),
  contact_id: z.string().max(40).optional(),
  name: z.string().max(120).optional(),
});

function upload(req: Request, res: Response, next: NextFunction) {
  if (!req.is('multipart/form-data')) return next();
  multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes(), files: 1, fields: 20 } }).single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(tooLarge('Attachment exceeds the configured size limit'));
    if (err) return next(new AppError(400, 'upload_error', err instanceof Error ? err.message : 'Upload failed'));
    next();
  });
}

const sourceOf = (p: Principal) => (p.type === 'user' ? 'dashboard' : p.type === 'oauth' ? 'mcp' : 'api') as 'dashboard' | 'api' | 'mcp';
const statusFor = (outcome: { status: string }) => (outcome.status === 'pending_approval' ? 202 : 200);

async function send(req: Request, principal: Principal, accountId: string, recipientInput: z.infer<typeof recipient>, build: (chatId: string) => Promise<OutboundPayload>, request: unknown) {
  const key = req.get('idempotency-key') ?? undefined;
  const r = await withIdempotency(`${principal.type}:${principal.id}`, key, { accountId, request }, async () => {
    const resolved = await resolveRecipient(accountId, recipientInput);
    const payload = await build(resolved.waChatId);
    const outcome = await requestSend(principal, payload, { source: sourceOf(principal), recipientLabel: resolved.label, ip: req.ip });
    return { status: statusFor(outcome), body: outcome };
  });
  return r;
}

export function messagingRoutes(r: Router) {
  route(r, {
    method: 'post', path: '/accounts/:accountId/messages/send', summary: 'Send a text message', description: 'Returns 200 with status "sent", or 202 with status "pending_approval" when the integration requires approval (NOT sent). Ambiguous recipients return 409 with candidates.', tags: ['Messaging'], params: acc, idempotent: true,
    body: recipient.extend({ text: z.string().min(1).max(4096) }),
    handler: async ({ req, res, principal, params, body }) => {
      assertCan(principal, 'messages:send', params.accountId);
      const out = await send(req, principal, params.accountId, body, async (chatId) => ({ kind: 'text', account_id: params.accountId, chat_id: chatId, text: body.text }), body);
      res.status(out.status).json({ data: out.body, ...(out.replayed ? { meta: { idempotent_replay: true } } : {}) });
    },
  });

  route(r, {
    method: 'post', path: '/accounts/:accountId/messages/reply', summary: 'Reply to a message', tags: ['Messaging'], params: acc, idempotent: true,
    body: z.object({ message_id: z.string().min(1).max(255), text: z.string().min(1).max(4096) }),
    handler: async ({ req, res, principal, params, body }) => {
      assertCan(principal, 'messages:send', params.accountId);
      const m = await prisma().message.findFirst({ where: { accountId: params.accountId, OR: [{ id: body.message_id }, { waMessageId: body.message_id }] }, include: { chat: true } });
      if (!m) throw notFound('Message');
      const out = await send(req, principal, params.accountId, { chat_id: m.chat.waChatId }, async (chatId) => ({ kind: 'text', account_id: params.accountId, chat_id: chatId, text: body.text, quoted_message_id: m.id }), body);
      res.status(out.status).json({ data: out.body, ...(out.replayed ? { meta: { idempotent_replay: true } } : {}) });
    },
  });

  route(r, {
    method: 'post', path: '/accounts/:accountId/messages/media', summary: 'Send an image, video, document or audio file',
    description: 'Accepts multipart/form-data (field "file" plus recipient fields) or JSON with attachment_id, file_url or file_base64.', tags: ['Messaging'], params: acc, idempotent: true,
    middleware: [upload],
    body: recipient.extend({
      attachment_id: z.string().max(40).optional(),
      file_url: z.url().max(2048).optional(),
      file_base64: z.string().max(140_000_000).optional(),
      filename: z.string().max(180).optional(),
      caption: z.string().max(1024).optional(),
      send_as: z.enum(['auto', 'document', 'voice']).default('auto'),
      quoted_message_id: z.string().max(255).optional(),
    }),
    handler: async ({ req, res, principal, params, body }) => {
      assertCan(principal, 'media:send', params.accountId);
      assertCan(principal, 'messages:send', params.accountId);
      const file = (req as any).file as Express.Multer.File | undefined;
      const sources = [file, body.attachment_id, body.file_url, body.file_base64].filter(Boolean).length;
      if (sources !== 1) throw validationError('Provide exactly one of file, attachment_id, file_url or file_base64');
      const userId = principal.type === 'user' ? principal.id : principal.userId ?? null;
      let attachmentId = body.attachment_id;
      if (!attachmentId) {
        const att = file
          ? await storeUpload(params.accountId, file.buffer, file.mimetype, body.filename ?? file.originalname, 'upload', userId)
          : body.file_url
            ? await storeFromUrl(params.accountId, body.file_url, body.filename ?? null, userId)
            : await storeUpload(params.accountId, Buffer.from(body.file_base64!, 'base64'), null, body.filename ?? null, 'inline', userId);
        attachmentId = att.id;
      }
      const { file_base64: _b, ...hashable } = body;
      const att = await prisma().messageAttachment.findFirst({ where: { id: attachmentId, accountId: params.accountId } });
      const out = await send(req, principal, params.accountId, body, async (chatId) => buildMediaPayload(params.accountId, chatId, attachmentId!, body.caption, body.send_as, body.quoted_message_id), { ...hashable, checksum: att?.checksum });
      res.status(out.status).json({ data: out.body, ...(out.replayed ? { meta: { idempotent_replay: true } } : {}) });
    },
  });

  route(r, {
    method: 'post', path: '/accounts/:accountId/messages/react', summary: 'React to a message', tags: ['Messaging'], params: acc, idempotent: true,
    body: z.object({ message_id: z.string().min(1).max(255), emoji: z.string().max(16) }),
    handler: async ({ req, res, principal, params, body }) => {
      assertCan(principal, 'messages:send', params.accountId);
      const m = await prisma().message.findFirst({ where: { accountId: params.accountId, OR: [{ id: body.message_id }, { waMessageId: body.message_id }] }, include: { chat: true } });
      if (!m) throw notFound('Message');
      const out = await withIdempotency(`${principal.type}:${principal.id}`, req.get('idempotency-key') ?? undefined, { a: params.accountId, body }, async () => {
        const o = await requestSend(principal, { kind: 'reaction', account_id: params.accountId, chat_id: m.chat.waChatId, message_id: m.id, emoji: body.emoji }, { source: sourceOf(principal), recipientLabel: m.chat.name });
        return { status: statusFor(o), body: o };
      });
      res.status(out.status).json({ data: out.body });
    },
  });

  route(r, {
    method: 'post', path: '/accounts/:accountId/attachments', summary: 'Upload an attachment for later sending or scheduling', tags: ['Media'], params: acc, status: 201,
    middleware: [upload],
    body: z.object({ filename: z.string().max(180).optional(), file_url: z.url().max(2048).optional() }),
    handler: async ({ req, principal, params, body }) => {
      assertCan(principal, 'media:send', params.accountId);
      const file = (req as any).file as Express.Multer.File | undefined;
      const userId = principal.type === 'user' ? principal.id : principal.userId ?? null;
      if (!file && !body.file_url) throw validationError('Provide a file (multipart field "file") or file_url');
      const att = file ? await storeUpload(params.accountId, file.buffer, file.mimetype, body.filename ?? file.originalname, 'upload', userId) : await storeFromUrl(params.accountId, body.file_url!, body.filename ?? null, userId);
      await audit({ action: 'media.uploaded', actor: principal, accountId: params.accountId, metadata: { attachmentId: att.id, mime: att.mimeType, size: att.sizeBytes } });
      return serializeAttachment(att);
    },
  });

  route(r, {
    method: 'get', path: '/media/:id', summary: 'Download an attachment (authenticated)', tags: ['Media'], params: z.object({ id: z.string().max(40) }),
    query: z.object({ download: z.enum(['0', '1']).optional() }),
    handler: async ({ res, principal, params, query }) => {
      const att = await prisma().messageAttachment.findUnique({ where: { id: params.id } });
      if (!att) throw notFound('Attachment');
      assertCan(principal, 'media:read', att.accountId);
      if (att.state !== 'STORED') throw new AppError(404, 'not_downloaded', `Attachment is ${att.state.toLowerCase()}`, { state: att.state.toLowerCase() });
      const inline = inlineSafe(att.mimeType) && query.download !== '1';
      const name = (att.originalFilename ?? 'attachment').replace(/["\\\r\n]/g, '_');
      res.setHeader('Content-Type', inline ? att.mimeType : 'application/octet-stream');
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=3600');
      if (att.sizeBytes) res.setHeader('Content-Length', String(att.sizeBytes));
      res.locals.streaming = true;
      attachmentStream(att).on('error', () => res.destroy()).pipe(res);
    },
  });

  route(r, {
    method: 'post', path: '/media/:id/fetch', summary: 'Download media for a message from WhatsApp on demand', tags: ['Media'], params: z.object({ id: z.string().max(40) }),
    handler: async ({ principal, params }) => {
      const att = await prisma().messageAttachment.findUnique({ where: { id: params.id }, include: { message: true } });
      if (!att || !att.message) throw notFound('Attachment');
      assertCan(principal, 'media:read', att.accountId);
      if (att.state === 'STORED') return serializeAttachment(att);
      const client = sessionManager().requireClient(att.accountId);
      const waMsg = await client.getMessageById(att.message.waMessageId).catch(() => null);
      if (!waMsg) throw new AppError(404, 'media_unavailable', 'This media is no longer available from WhatsApp Web');
      const stored = await downloadMessageMedia(att.accountId, att.message.id, waMsg);
      if (!stored) throw new AppError(422, 'media_unavailable', 'Media could not be downloaded (it may exceed the size limit or have expired)');
      return serializeAttachment(stored);
    },
  });
}
