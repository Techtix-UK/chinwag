import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { sha256 } from '../lib/crypto.js';
import { AppError, notFound, tooLarge, validationError } from '../lib/errors.js';
import { safeFetch, BlockedDestinationError } from '../lib/netguard.js';
import { settings } from './settings.js';
import type { MessageAttachment } from '../generated/prisma/client.js';

/** MIME types accepted for upload/sending. Active content (HTML, SVG, scripts, executables) is rejected. */
export const ALLOWED_MIME: Record<string, 'image' | 'video' | 'audio' | 'document'> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'video/3gpp': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/ogg': 'audio',
  'audio/opus': 'audio',
  'audio/aac': 'audio',
  'audio/mp4': 'audio',
  'audio/x-m4a': 'audio',
  'audio/amr': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.ms-powerpoint': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
  'application/vnd.oasis.opendocument.text': 'document',
  'application/vnd.oasis.opendocument.spreadsheet': 'document',
  'application/zip': 'document',
  'text/plain': 'document',
  'text/csv': 'document',
};

/** Text formats have no magic bytes; accepted only if the content is valid UTF-8 without NUL bytes. */
const TEXT_MIME = new Set(['text/plain', 'text/csv']);

export function maxBytes(): number {
  return settings().maxAttachmentMb * 1024 * 1024;
}

export function safeFilename(name: string | null | undefined, fallback = 'file'): string {
  const base = path.basename(String(name ?? '')).normalize('NFKC');
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').replace(/^\.+/, '').trim().slice(0, 180);
  return cleaned || fallback;
}

export async function detectMime(buffer: Buffer, declared?: string | null, filename?: string | null): Promise<string> {
  const ft = await fileTypeFromBuffer(buffer);
  let mime = ft?.mime as string | undefined;
  if (mime === 'audio/x-m4a') mime = 'audio/mp4';
  // OOXML documents are ZIP containers; trust the declared OOXML type when the container is a ZIP.
  if (mime === 'application/zip' && declared && /^application\/vnd\.openxmlformats|^application\/vnd\.oasis/.test(declared)) mime = declared;
  if (mime === 'application/x-cfb' && declared && /msword|ms-excel|ms-powerpoint/.test(declared)) mime = declared;
  if (!mime) {
    const d = (declared ?? '').split(';')[0].trim().toLowerCase();
    const extText = /\.(txt|csv)$/i.test(filename ?? '');
    if ((TEXT_MIME.has(d) || extText) && !buffer.includes(0)) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        return d && TEXT_MIME.has(d) ? d : /\.csv$/i.test(filename ?? '') ? 'text/csv' : 'text/plain';
      } catch {
        /* not utf-8 */
      }
    }
    throw validationError('Unsupported or unrecognised file type');
  }
  if (!ALLOWED_MIME[mime]) throw validationError(`File type ${mime} is not allowed`);
  return mime;
}

function storagePathFor(accountId: string, id: string): string {
  const d = new Date();
  return path.join(accountId, String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'), id);
}

export function absolutePath(rel: string): string {
  const root = path.resolve(env().mediaDir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) throw new AppError(400, 'bad_path', 'Invalid storage path');
  return abs;
}

export async function storeBuffer(input: {
  accountId: string;
  buffer: Buffer;
  mimeType: string;
  filename?: string | null;
  source: 'whatsapp' | 'upload' | 'url' | 'inline';
  messageId?: string | null;
  uploadedByUserId?: string | null;
  attachmentId?: string;
}): Promise<MessageAttachment> {
  const att = input.attachmentId
    ? await prisma().messageAttachment.findUniqueOrThrow({ where: { id: input.attachmentId } })
    : await prisma().messageAttachment.create({
        data: {
          accountId: input.accountId,
          messageId: input.messageId ?? null,
          mimeType: input.mimeType,
          originalFilename: input.filename ? safeFilename(input.filename) : null,
          source: input.source,
          uploadedByUserId: input.uploadedByUserId ?? null,
          state: 'PENDING',
        },
      });
  const rel = storagePathFor(input.accountId, att.id);
  const abs = absolutePath(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
  await fs.writeFile(abs, input.buffer, { mode: 0o600 });
  return prisma().messageAttachment.update({
    where: { id: att.id },
    data: {
      storagePath: rel,
      sizeBytes: input.buffer.length,
      checksum: sha256(input.buffer),
      mimeType: input.mimeType,
      state: 'STORED',
      originalFilename: input.filename ? safeFilename(input.filename) : att.originalFilename,
    },
  });
}

/** Validate and store an uploaded file for later sending. */
export async function storeUpload(accountId: string, buffer: Buffer, declaredMime: string | null, filename: string | null, source: 'upload' | 'url' | 'inline', userId?: string | null) {
  if (buffer.length === 0) throw validationError('File is empty');
  if (buffer.length > maxBytes()) throw tooLarge(`Attachments are limited to ${settings().maxAttachmentMb} MB`);
  const mime = await detectMime(buffer, declaredMime, filename);
  return storeBuffer({ accountId, buffer, mimeType: mime, filename: safeFilename(filename, defaultName(mime)), source, uploadedByUserId: userId ?? null });
}

function defaultName(mime: string): string {
  const ext: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'application/pdf': 'pdf' };
  return `attachment.${ext[mime] ?? 'bin'}`;
}

/** Download an externally supplied attachment URL with SSRF protection and size limits. */
export async function storeFromUrl(accountId: string, url: string, filename: string | null, userId?: string | null) {
  try {
    const res = await safeFetch(url, { maxBytes: maxBytes(), timeoutMs: 30000 });
    if (res.status < 200 || res.status >= 300) throw validationError(`Attachment URL returned HTTP ${res.status}`);
    const urlName = decodeURIComponent(new URL(res.finalUrl).pathname.split('/').pop() || '') || null;
    return storeUpload(accountId, res.body, String(res.headers['content-type'] ?? ''), filename ?? urlName, 'url', userId);
  } catch (e) {
    if (e instanceof BlockedDestinationError) throw validationError(`Attachment URL rejected: ${e.message}`);
    if (e instanceof AppError) throw e;
    throw validationError(`Could not download attachment: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function readAttachmentBuffer(att: MessageAttachment): Promise<Buffer> {
  if (att.state !== 'STORED' || !att.storagePath) throw notFound('Attachment file');
  return fs.readFile(absolutePath(att.storagePath));
}

export function attachmentStream(att: MessageAttachment) {
  if (att.state !== 'STORED' || !att.storagePath) throw notFound('Attachment file');
  return createReadStream(absolutePath(att.storagePath));
}

export async function deleteAttachmentFile(att: MessageAttachment) {
  if (att.storagePath) await fs.rm(absolutePath(att.storagePath), { force: true });
  await prisma().messageAttachment.update({ where: { id: att.id }, data: { state: 'DELETED', storagePath: null } });
}

export async function removeAccountMedia(accountId: string) {
  const dir = path.join(path.resolve(env().mediaDir), accountId);
  if (/^[a-z0-9]+$/i.test(accountId)) await fs.rm(dir, { recursive: true, force: true });
}

export function mediaKind(mime: string): 'image' | 'video' | 'audio' | 'document' {
  return ALLOWED_MIME[mime] ?? 'document';
}

/** Content types that are safe to render inline in the dashboard. Everything else is forced to download. */
export function inlineSafe(mime: string) {
  return /^(image\/(jpeg|png|webp|gif)|video\/(mp4|3gpp|quicktime)|audio\/.+)$/.test(mime);
}
