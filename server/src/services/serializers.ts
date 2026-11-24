import type { Chat, Contact, Message, MessageAttachment, MessageReaction, WhatsappAccount, ScheduledMessage, MessageApproval, ContactTag, ContactNote, GroupParticipant } from '../generated/prisma/client.js';
import { formatInternational } from '../lib/phone.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function serializeAccount(a: WhatsappAccount, live?: { status?: string; ready?: boolean; statusDetail?: string | null }) {
  return {
    id: a.id,
    display_name: a.displayName,
    phone_number: formatInternational(a.phoneNumber),
    wa_id: a.waId,
    profile_name: a.profileName,
    profile_pic_url: a.profilePicUrl,
    platform: a.platform,
    status: (live?.status ?? a.status).toLowerCase(),
    status_detail: live?.statusDetail ?? a.statusDetail,
    ready: live?.ready ?? a.status === 'CONNECTED',
    desired_state: a.desiredState.toLowerCase(),
    last_connected_at: iso(a.lastConnectedAt),
    last_disconnected_at: iso(a.lastDisconnectedAt),
    last_sync_at: iso(a.lastSyncAt),
    created_at: iso(a.createdAt),
  };
}

export function serializeChat(c: Chat & { _draft?: string | null }) {
  return {
    id: c.id,
    account_id: c.accountId,
    wa_chat_id: c.waChatId,
    name: c.name,
    type: c.isGroup ? 'group' : 'individual',
    is_group: c.isGroup,
    archived: c.isArchived,
    pinned: c.isPinned,
    muted: c.isMuted,
    read_only: c.isReadOnly,
    unread_count: c.unreadCount,
    profile_pic_url: c.profilePicUrl,
    last_message_at: iso(c.lastMessageAt),
    last_message_preview: c.lastMessagePreview,
    last_message_from_me: c.lastMessageFromMe,
    sync_state: c.syncState.toLowerCase(),
    synced_message_count: c.syncedMessageCount,
    last_synced_at: iso(c.lastSyncedAt),
    ...(c.isGroup ? { group: { description: c.groupDescription, owner: c.groupOwner, created_at: iso(c.groupCreatedAt) } } : {}),
    ...(c._draft !== undefined ? { draft: c._draft } : {}),
  };
}

export function serializeAttachment(a: MessageAttachment) {
  return {
    id: a.id,
    account_id: a.accountId,
    message_id: a.messageId,
    filename: a.originalFilename,
    mime_type: a.mimeType,
    size_bytes: a.sizeBytes,
    checksum_sha256: a.checksum,
    state: a.state.toLowerCase(),
    created_at: iso(a.createdAt),
    url: `/api/v1/media/${a.id}`,
  };
}

export function serializeReaction(r: MessageReaction) {
  return { sender_wa_id: r.senderWaId, emoji: r.emoji, timestamp: iso(r.timestamp) };
}

export function serializeMessage(m: Message & { attachments?: MessageAttachment[]; reactions?: MessageReaction[] }) {
  return {
    id: m.id,
    account_id: m.accountId,
    chat_id: m.chatId,
    wa_message_id: m.waMessageId,
    direction: m.direction.toLowerCase(),
    from_me: m.direction === 'OUTBOUND',
    type: m.type,
    body: m.body,
    sender_wa_id: m.senderWaId,
    sender_name: m.senderName,
    status: m.status.toLowerCase(),
    timestamp: iso(m.timestamp),
    has_media: m.hasMedia,
    quoted: m.quotedWaMessageId || m.quotedBody ? { wa_message_id: m.quotedWaMessageId, body: m.quotedBody } : null,
    forwarded: m.isForwarded,
    edited: m.isEdited,
    edited_at: iso(m.editedAt),
    deleted: m.isDeleted,
    location: m.locationLat != null && m.locationLng != null ? { latitude: m.locationLat, longitude: m.locationLng, name: m.locationName } : null,
    sent_via: m.sentVia,
    error: m.errorDetail,
    attachments: (m.attachments ?? []).map(serializeAttachment),
    reactions: (m.reactions ?? []).map(serializeReaction),
  };
}

export function serializeContact(c: Contact & { tags?: ContactTag[]; notes?: ContactNote[] }) {
  return {
    id: c.id,
    account_id: c.accountId,
    wa_id: c.waId,
    phone_number: formatInternational(c.phoneNumber),
    display_name: c.displayName,
    profile_name: c.profileName,
    name: c.displayName || c.profileName || formatInternational(c.phoneNumber) || c.waId,
    profile_pic_url: c.profilePicUrl,
    is_business: c.isBusiness,
    is_enterprise: c.isEnterprise,
    is_my_contact: c.isMyContact,
    is_group: c.isGroup,
    is_blocked: c.isBlocked,
    last_interaction_at: iso(c.lastInteractionAt),
    tags: (c.tags ?? []).map((t) => t.tag),
    ...(c.notes ? { notes: c.notes.map((n) => ({ id: n.id, body: n.body, author_id: n.authorId, created_at: iso(n.createdAt) })) } : {}),
  };
}

export function serializeParticipant(p: GroupParticipant & { contact?: Contact | null }) {
  return {
    wa_id: p.waId,
    is_admin: p.isAdmin,
    is_super_admin: p.isSuperAdmin,
    name: p.contact ? p.contact.displayName || p.contact.profileName : null,
    phone_number: p.contact ? formatInternational(p.contact.phoneNumber) : null,
  };
}

export function serializeScheduled(s: ScheduledMessage) {
  return {
    id: s.id,
    account_id: s.accountId,
    recipient_wa_id: s.recipientWaId,
    recipient_label: s.recipientLabel,
    body: s.body,
    attachment_id: s.attachmentId,
    scheduled_at: iso(s.scheduledAt),
    timezone: s.timezone,
    status: s.status.toLowerCase(),
    approval_status: s.approvalStatus.toLowerCase(),
    approval_id: s.approvalId,
    created_by: { type: s.createdByType, id: s.createdById, label: s.createdByLabel },
    attempts: s.attempts,
    error: s.errorDetail,
    sent_message_id: s.sentMessageId,
    sent_at: iso(s.sentAt),
    created_at: iso(s.createdAt),
    updated_at: iso(s.updatedAt),
  };
}

export function serializeApproval(a: MessageApproval) {
  return {
    id: a.id,
    account_id: a.accountId,
    kind: a.kind,
    recipient_wa_id: a.recipientWaId,
    recipient_label: a.recipientLabel,
    payload: a.payload,
    payload_hash: a.payloadHash,
    scheduled_message_id: a.scheduledMessageId,
    status: a.status.toLowerCase(),
    requested_by: { type: a.requestedByType, id: a.requestedById, label: a.requestedByLabel },
    decided_by_user_id: a.decidedByUserId,
    decision_note: a.decisionNote,
    decided_at: iso(a.decidedAt),
    result_message_id: a.resultMessageId,
    error: a.errorDetail,
    created_at: iso(a.createdAt),
  };
}
