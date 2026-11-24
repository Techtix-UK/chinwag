export interface Me {
  id: string;
  email: string;
  name: string;
  timezone: string;
  roles: string[];
  is_super_admin: boolean;
  dashboard_access: boolean;
  capabilities: string[];
  account_access: 'all' | Record<string, 'read' | 'send' | 'manage'>;
  csrf_token: string;
  app: { name: string; logo_url: string | null; default_timezone: string };
}

export interface Account {
  id: string;
  display_name: string;
  phone_number: string | null;
  wa_id: string | null;
  profile_name: string | null;
  profile_pic_url: string | null;
  platform: string | null;
  status: string;
  status_detail: string | null;
  ready: boolean;
  desired_state: string;
  last_connected_at: string | null;
  last_disconnected_at: string | null;
  last_sync_at: string | null;
  created_at: string;
}

export interface Chat {
  id: string;
  account_id: string;
  wa_chat_id: string;
  name: string | null;
  type: 'group' | 'individual';
  is_group: boolean;
  archived: boolean;
  pinned: boolean;
  muted: boolean;
  read_only: boolean;
  unread_count: number;
  profile_pic_url: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_from_me: boolean | null;
  sync_state: 'full' | 'partial' | 'unavailable';
  synced_message_count: number;
  group?: { description: string | null; owner: string | null; created_at: string | null };
  draft?: string | null;
  contact?: Contact | null;
  participant_count?: number;
}

export interface Attachment {
  id: string;
  filename: string | null;
  mime_type: string;
  size_bytes: number | null;
  state: string;
  url: string;
}

export interface Message {
  id: string;
  account_id: string;
  chat_id: string;
  wa_message_id: string;
  direction: 'inbound' | 'outbound';
  from_me: boolean;
  type: string;
  body: string | null;
  sender_wa_id: string | null;
  sender_name: string | null;
  status: string;
  timestamp: string;
  has_media: boolean;
  quoted: { wa_message_id: string | null; body: string | null } | null;
  forwarded: boolean;
  edited: boolean;
  deleted: boolean;
  location: { latitude: number; longitude: number; name: string | null } | null;
  sent_via: string | null;
  attachments: Attachment[];
  reactions: { sender_wa_id: string; emoji: string }[];
  chat?: { id: string; wa_chat_id: string; name: string | null; is_group: boolean };
  _pending?: boolean;
  _error?: string;
}

export interface Contact {
  id: string;
  account_id: string;
  wa_id: string;
  phone_number: string | null;
  display_name: string | null;
  profile_name: string | null;
  name: string;
  profile_pic_url: string | null;
  is_business: boolean;
  is_my_contact: boolean;
  last_interaction_at: string | null;
  tags: string[];
  notes?: { id: string; body: string; created_at: string }[];
  chat?: Chat | null;
}

export interface Scheduled {
  id: string;
  account_id: string;
  recipient_wa_id: string;
  recipient_label: string | null;
  body: string | null;
  attachment_id: string | null;
  scheduled_at: string;
  timezone: string;
  status: string;
  approval_status: string;
  approval_id: string | null;
  created_by: { type: string; id: string; label: string | null };
  attempts: number;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface Approval {
  id: string;
  account_id: string;
  kind: string;
  recipient_wa_id: string;
  recipient_label: string | null;
  payload: any;
  status: string;
  scheduled_message_id: string | null;
  requested_by: { type: string; id: string; label: string | null };
  decision_note: string | null;
  decided_at: string | null;
  error: string | null;
  created_at: string;
}
