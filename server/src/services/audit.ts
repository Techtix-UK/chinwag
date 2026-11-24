import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import type { Principal } from './permissions.js';

const log = logger('audit');

/** Keys that must never be persisted to audit metadata. */
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|qr|session|key$|body|content|text|caption|data/i;

export function scrub(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = scrub(v as Record<string, unknown>);
    else if (typeof v === 'string' && v.length > 300) out[k] = v.slice(0, 300) + '…';
    else out[k] = v;
  }
  return out;
}

export interface AuditInput {
  action: string;
  actor?: Principal | { type: string; id?: string | null; label?: string | null } | null;
  source?: 'dashboard' | 'api' | 'mcp' | 'system' | 'oauth' | 'setup' | 'scheduler' | 'webhook';
  accountId?: string | null;
  result?: 'success' | 'failure' | 'denied' | 'pending';
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

export async function audit(input: AuditInput): Promise<void> {
  const actor = input.actor;
  try {
    await prisma().auditLog.create({
      data: {
        action: input.action,
        actorType: actor?.type ?? 'system',
        actorId: actor && 'id' in actor ? (actor.id ?? null) : null,
        actorLabel: actor && 'label' in actor ? (actor.label ?? null) : null,
        source: input.source ?? (actor ? sourceFor(actor.type) ?? 'system' : 'system'),
        accountId: input.accountId ?? null,
        result: input.result ?? 'success',
        ipAddress: input.ip ?? (actor && 'ip' in actor ? ((actor as any).ip ?? null) : null),
        metadata: (scrub(input.metadata) as any) ?? undefined,
      },
    });
  } catch (e) {
    log.error('Failed to write audit log', { action: input.action, error: e instanceof Error ? e.message : String(e) });
  }
}

function sourceFor(type: string): AuditInput['source'] {
  if (type === 'user') return 'dashboard';
  if (type === 'api_key') return 'api';
  if (type === 'oauth') return 'mcp';
  return 'system';
}

export async function systemEvent(level: 'info' | 'warn' | 'error', component: string, message: string, detail?: Record<string, unknown>, accountId?: string) {
  try {
    await prisma().systemEvent.create({
      data: { level, component, message: message.slice(0, 1000), accountId: accountId ?? null, detail: (scrub(detail) as any) ?? undefined },
    });
  } catch {
    /* database unavailable — already logged by caller */
  }
}
