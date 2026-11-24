import type { MessageStatus } from '../generated/prisma/client.js';
import type { WaMessage } from './types.js';

export const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker']);
/** Message types not worth storing as conversation content. */
export const IGNORED_TYPES = new Set(['e2e_notification', 'notification_template', 'protocol', 'ciphertext', 'debug', 'reaction', 'gp2', 'call_log', 'broadcast_notification']);

export function ackToStatus(ack: number | undefined | null, fromMe: boolean): MessageStatus {
  if (!fromMe) return 'RECEIVED';
  switch (ack) {
    case -1:
      return 'FAILED';
    case 0:
      return 'PENDING';
    case 1:
      return 'SENT';
    case 2:
      return 'DELIVERED';
    case 3:
      return 'READ';
    case 4:
      return 'PLAYED';
    default:
      return 'SENT';
  }
}

export function chatIdOf(msg: Pick<WaMessage, 'fromMe' | 'from' | 'to' | 'id'>): string {
  return msg.id?.remote || (msg.fromMe ? msg.to : msg.from);
}

export function previewOf(type: string, body: string | null | undefined): string {
  const b = (body ?? '').replace(/\s+/g, ' ').trim();
  const labels: Record<string, string> = {
    image: '📷 Photo',
    video: '🎥 Video',
    audio: '🎵 Audio',
    ptt: '🎤 Voice message',
    document: '📄 Document',
    sticker: 'Sticker',
    location: '📍 Location',
    vcard: '👤 Contact',
    multi_vcard: '👥 Contacts',
    revoked: 'This message was deleted',
    poll_creation: '📊 Poll',
  };
  if (type === 'chat') return b.slice(0, 250);
  const label = labels[type] ?? (b ? '' : type);
  return (label + (b && type !== 'revoked' ? (label ? ' · ' : '') + b : '')).slice(0, 250);
}

export interface MappedMessage {
  waMessageId: string;
  waChatId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  body: string | null;
  senderWaId: string | null;
  senderName: string | null;
  status: MessageStatus;
  ack: number | null;
  timestamp: Date;
  hasMedia: boolean;
  isForwarded: boolean;
  locationLat: number | null;
  locationLng: number | null;
  locationName: string | null;
  isEdited: boolean;
}

export function mapMessage(msg: WaMessage): MappedMessage {
  const raw = ((msg as any).rawData ?? (msg as any)._data ?? {}) as Record<string, any>;
  const type = String(msg.type ?? 'unknown');
  const isMediaType = MEDIA_TYPES.has(type);
  // For media messages, body holds base64 thumbnails in some versions; caption is the meaningful text.
  let body: string | null = msg.body ?? null;
  if (isMediaType) body = (raw.caption as string | undefined) ?? null;
  if (type === 'location') body = (msg.location?.description ?? msg.location?.name ?? null) as string | null;
  const fromMe = !!msg.fromMe;
  const senderWaId = fromMe ? null : (msg.author || msg.from || null);
  const lat = msg.location ? Number(msg.location.latitude) : null;
  const lng = msg.location ? Number(msg.location.longitude) : null;
  return {
    waMessageId: msg.id._serialized,
    waChatId: chatIdOf(msg),
    direction: fromMe ? 'OUTBOUND' : 'INBOUND',
    type,
    body: body && body.length > 65000 ? body.slice(0, 65000) : body,
    senderWaId,
    senderName: (raw.notifyName as string) || null,
    status: ackToStatus(msg.ack, fromMe),
    ack: typeof msg.ack === 'number' ? msg.ack : null,
    timestamp: new Date((msg.timestamp ?? Math.floor(Date.now() / 1000)) * 1000),
    hasMedia: !!msg.hasMedia || isMediaType,
    isForwarded: !!msg.isForwarded,
    locationLat: Number.isFinite(lat) ? lat : null,
    locationLng: Number.isFinite(lng) ? lng : null,
    locationName: msg.location?.name ?? msg.location?.address ?? null,
    isEdited: !!msg.latestEditSenderTimestampMs,
  };
}

export function documentFilename(msg: WaMessage): string | null {
  const raw = ((msg as any).rawData ?? (msg as any)._data ?? {}) as Record<string, any>;
  return (raw.filename as string) || null;
}
