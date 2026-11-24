import { EventEmitter } from 'node:events';

/** Public event names (also webhook event types). */
export const WEBHOOK_EVENTS = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'account.connected',
  'account.disconnected',
  'account.authentication_failed',
  'scheduled_message.sent',
  'scheduled_message.failed',
  'approval.requested',
  'approval.completed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Internal real-time event types pushed to dashboard sockets. */
export type RealtimeEvent =
  | 'account.status'
  | 'account.qr'
  | 'message.upsert'
  | 'message.ack'
  | 'chat.upsert'
  | 'approval.changed'
  | 'scheduled.changed'
  | 'sync.progress';

export interface BusEvent {
  type: WebhookEvent | RealtimeEvent;
  accountId?: string | null;
  data: Record<string, unknown>;
  /** Realtime visibility: 'read' (default) to account readers, 'manage' to account managers only. */
  audience?: 'read' | 'manage' | 'reviewers';
  /** Whether this event should be forwarded to webhooks. */
  webhook?: boolean;
}

class Bus extends EventEmitter {
  publish(evt: BusEvent) {
    this.emit('event', evt);
  }
}

export const bus = new Bus();
bus.setMaxListeners(50);
