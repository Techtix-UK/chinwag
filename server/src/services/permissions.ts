import type { AccountAccessLevel, ApprovalPolicy } from '../generated/prisma/client.js';
import { forbidden } from '../lib/errors.js';

/** Data scopes — used both as integration (API key / OAuth) scopes and as user permissions. */
export const DATA_SCOPES = [
  'accounts:read',
  'accounts:manage',
  'chats:read',
  'messages:read',
  'messages:send',
  'contacts:read',
  'contacts:write',
  'groups:read',
  'media:read',
  'media:send',
  'schedule:read',
  'schedule:write',
] as const;

/** Scopes that may be granted to MCP (OAuth) clients. */
export const MCP_SCOPES = [
  'accounts:read',
  'chats:read',
  'messages:read',
  'messages:send',
  'contacts:read',
  'groups:read',
  'media:read',
  'media:send',
  'schedule:read',
  'schedule:write',
] as const;

/** Administrative permissions — only meaningful for dashboard users. */
export const ADMIN_PERMISSIONS = [
  'dashboard:access',
  'approvals:review',
  'integrations:manage',
  'webhooks:manage',
  'users:manage',
  'audit:read',
  'system:read',
  'settings:manage',
] as const;

export type Scope = (typeof DATA_SCOPES)[number];
export type Capability = Scope | (typeof ADMIN_PERMISSIONS)[number];
export const ALL_CAPABILITIES: Capability[] = [...DATA_SCOPES, ...ADMIN_PERMISSIONS];

export const SCOPE_DESCRIPTIONS: Record<Capability, string> = {
  'accounts:read': 'View WhatsApp accounts and connection status',
  'accounts:manage': 'Connect, disconnect, restart and manage WhatsApp accounts',
  'chats:read': 'View conversations',
  'messages:read': 'Read messages',
  'messages:send': 'Send messages, replies and reactions',
  'contacts:read': 'View contacts',
  'contacts:write': 'Edit contact notes and tags',
  'groups:read': 'View groups and participants',
  'media:read': 'Download attachments',
  'media:send': 'Send attachments',
  'schedule:read': 'View scheduled messages',
  'schedule:write': 'Create, change and cancel scheduled messages',
  'dashboard:access': 'Use the administration dashboard',
  'approvals:review': 'Approve or reject outbound messages from integrations',
  'integrations:manage': 'Manage API keys and MCP clients',
  'webhooks:manage': 'Manage webhooks',
  'users:manage': 'Manage users and permissions',
  'audit:read': 'View activity logs',
  'system:read': 'View system health',
  'settings:manage': 'Change application settings',
};

/** Minimum per-account access level a capability requires. */
const REQUIRED_LEVEL: Partial<Record<Capability, AccountAccessLevel>> = {
  'accounts:read': 'READ',
  'chats:read': 'READ',
  'messages:read': 'READ',
  'contacts:read': 'READ',
  'groups:read': 'READ',
  'media:read': 'READ',
  'schedule:read': 'READ',
  'messages:send': 'SEND',
  'media:send': 'SEND',
  'schedule:write': 'SEND',
  'contacts:write': 'SEND',
  'approvals:review': 'SEND',
  'accounts:manage': 'MANAGE',
};

const RANK: Record<AccountAccessLevel, number> = { READ: 1, SEND: 2, MANAGE: 3 };

export const DEFAULT_ROLES: { key: string; name: string; description: string; permissions: Capability[] }[] = [
  {
    key: 'super_admin',
    name: 'Super Administrator',
    description: 'Full access to all settings, accounts, users, integrations and system administration.',
    permissions: ALL_CAPABILITIES,
  },
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Manage assigned accounts, conversations, integrations and users within granted permissions.',
    permissions: [...DATA_SCOPES, 'dashboard:access', 'approvals:review', 'integrations:manage', 'webhooks:manage', 'users:manage', 'audit:read', 'system:read'],
  },
  {
    key: 'agent',
    name: 'Messaging Agent',
    description: 'Read and respond to conversations for assigned WhatsApp accounts.',
    permissions: ['dashboard:access', 'accounts:read', 'chats:read', 'messages:read', 'messages:send', 'contacts:read', 'contacts:write', 'groups:read', 'media:read', 'media:send', 'schedule:read', 'schedule:write'],
  },
  {
    key: 'read_only',
    name: 'Read-only User',
    description: 'View permitted conversations without sending messages.',
    permissions: ['dashboard:access', 'accounts:read', 'chats:read', 'messages:read', 'contacts:read', 'groups:read', 'media:read', 'schedule:read'],
  },
  {
    key: 'integration_client',
    name: 'Integration Client',
    description: 'No dashboard access. May authorise MCP/OAuth clients limited to explicitly granted capabilities and accounts.',
    permissions: ['accounts:read', 'chats:read', 'messages:read', 'messages:send', 'contacts:read', 'groups:read', 'media:read', 'media:send', 'schedule:read', 'schedule:write'],
  },
];

export type PrincipalType = 'user' | 'api_key' | 'oauth' | 'system';

export interface Principal {
  type: PrincipalType;
  id: string;
  label: string;
  userId?: string;
  isSuperAdmin: boolean;
  roles: string[];
  capabilities: Set<Capability>;
  /** 'all' = every account; otherwise explicit per-account levels. */
  accountAccess: 'all' | Map<string, AccountAccessLevel>;
  /** Only set for integrations (API keys, OAuth). */
  approvalPolicy?: ApprovalPolicy;
  sessionId?: string;
  csrfToken?: string;
  timezone?: string | null;
  ip?: string;
}

export function isIntegration(p: Principal): boolean {
  return p.type === 'api_key' || p.type === 'oauth';
}

export function can(p: Principal, cap: Capability, accountId?: string | null): boolean {
  if (p.isSuperAdmin) return true;
  if (!p.capabilities.has(cap)) return false;
  if (!accountId) return true;
  if (p.accountAccess === 'all') return true;
  const level = p.accountAccess.get(accountId);
  if (!level) return false;
  const req = REQUIRED_LEVEL[cap] ?? 'READ';
  return RANK[level] >= RANK[req];
}

export function assertCan(p: Principal, cap: Capability, accountId?: string | null): void {
  if (!can(p, cap, accountId)) {
    throw forbidden(accountId ? `Missing permission ${cap} for this WhatsApp account` : `Missing permission ${cap}`);
  }
}

/** Account IDs on which the principal holds `cap`; 'all' when unrestricted. */
export function accountsWith(p: Principal, cap: Capability): 'all' | string[] {
  if (p.isSuperAdmin) return 'all';
  if (!p.capabilities.has(cap)) return [];
  if (p.accountAccess === 'all') return 'all';
  const req = REQUIRED_LEVEL[cap] ?? 'READ';
  return [...p.accountAccess.entries()].filter(([, l]) => RANK[l] >= RANK[req]).map(([id]) => id);
}

export function accountFilter(p: Principal, cap: Capability): { in: string[] } | undefined {
  const a = accountsWith(p, cap);
  return a === 'all' ? undefined : { in: a };
}

export function minLevel(a: AccountAccessLevel, b: AccountAccessLevel): AccountAccessLevel {
  return RANK[a] <= RANK[b] ? a : b;
}

export function levelRank(l: AccountAccessLevel) {
  return RANK[l];
}

export const SYSTEM_PRINCIPAL: Principal = {
  type: 'system',
  id: 'system',
  label: 'System',
  isSuperAdmin: true,
  roles: [],
  capabilities: new Set(ALL_CAPABILITIES),
  accountAccess: 'all',
};
