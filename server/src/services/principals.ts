import type { AccountAccessLevel } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { type Capability, type Principal, type Scope, ALL_CAPABILITIES, DATA_SCOPES, minLevel } from './permissions.js';

const userInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  accountPermissions: true,
} as const;

export async function loadUserPrincipal(userId: string): Promise<Principal | null> {
  const user = await prisma().user.findUnique({ where: { id: userId }, include: userInclude });
  if (!user || !user.isActive) return null;
  const roles = user.roles.map((r) => r.role.key);
  const isSuperAdmin = roles.includes('super_admin');
  const caps = new Set<Capability>();
  for (const ur of user.roles) for (const rp of ur.role.permissions) caps.add(rp.permission.key as Capability);
  if (isSuperAdmin) for (const c of ALL_CAPABILITIES) caps.add(c);
  const access = new Map<string, AccountAccessLevel>();
  for (const ap of user.accountPermissions) access.set(ap.accountId, ap.level);
  return {
    type: 'user',
    id: user.id,
    userId: user.id,
    label: `${user.name} <${user.email}>`,
    isSuperAdmin,
    roles,
    capabilities: caps,
    accountAccess: isSuperAdmin ? 'all' : access,
    timezone: user.timezone,
  };
}

export function apiKeyPrincipal(key: {
  id: string;
  name: string;
  prefix: string;
  scopes: unknown;
  accountIds: unknown;
  allAccounts: boolean;
  approvalPolicy: Principal['approvalPolicy'];
}): Principal {
  const scopes = new Set<Capability>(((key.scopes as string[]) ?? []).filter((s): s is Scope => (DATA_SCOPES as readonly string[]).includes(s)));
  const access = new Map<string, AccountAccessLevel>();
  for (const id of (key.accountIds as string[]) ?? []) access.set(id, 'MANAGE');
  return {
    type: 'api_key',
    id: key.id,
    label: `API key ${key.name} (${key.prefix})`,
    isSuperAdmin: false,
    roles: [],
    capabilities: scopes,
    accountAccess: key.allAccounts ? 'all' : access,
    approvalPolicy: key.approvalPolicy,
  };
}

/**
 * OAuth principal = intersection of the grant (scopes, accounts) with the consenting user's
 * *current* permissions, so removing a user's access immediately narrows their integrations.
 */
export async function oauthPrincipal(grant: {
  id: string;
  userId: string;
  scopes: unknown;
  accountIds: unknown;
  approvalPolicy: Principal['approvalPolicy'];
  client: { clientName: string | null; clientId: string };
}): Promise<Principal | null> {
  const user = await loadUserPrincipal(grant.userId);
  if (!user) return null;
  const caps = new Set<Capability>();
  for (const s of (grant.scopes as string[]) ?? []) {
    if ((DATA_SCOPES as readonly string[]).includes(s) && (user.isSuperAdmin || user.capabilities.has(s as Capability))) caps.add(s as Capability);
  }
  const access = new Map<string, AccountAccessLevel>();
  for (const id of (grant.accountIds as string[]) ?? []) {
    if (user.accountAccess === 'all') access.set(id, 'SEND');
    else {
      const l = user.accountAccess.get(id);
      if (l) access.set(id, minLevel(l, 'SEND'));
    }
  }
  return {
    type: 'oauth',
    id: grant.id,
    userId: grant.userId,
    label: `${grant.client.clientName ?? grant.client.clientId} (authorised by ${user.label})`,
    isSuperAdmin: false,
    roles: [],
    capabilities: caps,
    accountAccess: access,
    approvalPolicy: grant.approvalPolicy,
  };
}
