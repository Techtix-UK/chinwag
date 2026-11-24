import { prisma } from '../db/prisma.js';
import type { ApiKey, ApprovalPolicy } from '../generated/prisma/client.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { forbidden, notFound, validationError } from '../lib/errors.js';
import { audit } from './audit.js';
import { DATA_SCOPES, can, type Principal, type Scope } from './permissions.js';
import { apiKeyPrincipal } from './principals.js';

export const API_KEY_PREFIX = 'ttw_';

export function serializeApiKey(k: ApiKey) {
  const expired = !!k.expiresAt && k.expiresAt < new Date();
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    account_ids: k.accountIds,
    all_accounts: k.allAccounts,
    approval_policy: k.approvalPolicy.toLowerCase(),
    expires_at: k.expiresAt?.toISOString() ?? null,
    last_used_at: k.lastUsedAt?.toISOString() ?? null,
    created_at: k.createdAt.toISOString(),
    revoked_at: k.revokedAt?.toISOString() ?? null,
    status: k.revokedAt ? 'revoked' : expired ? 'expired' : 'active',
  };
}

/** Admins cannot grant integrations more than they themselves hold. */
function assertGrantable(p: Principal, scopes: string[], accountIds: string[], allAccounts: boolean, policy: ApprovalPolicy) {
  for (const s of scopes) {
    if (!(DATA_SCOPES as readonly string[]).includes(s)) throw validationError(`Unknown scope ${s}`);
    if (!can(p, s as Scope)) throw forbidden(`You cannot grant ${s}`);
    for (const a of accountIds) if (!can(p, s as Scope, a)) throw forbidden(`You cannot grant ${s} on account ${a}`);
  }
  if (allAccounts && !p.isSuperAdmin) throw forbidden('Only super administrators can create keys for all accounts');
  if (policy === 'DIRECT' && !can(p, 'integrations:manage')) throw forbidden('Direct sending requires integrations:manage');
}

export async function createApiKey(p: Principal, input: { name: string; scopes: string[]; accountIds: string[]; allAccounts: boolean; approvalPolicy: ApprovalPolicy; expiresAt: Date | null }, rotatedFromId?: string) {
  assertGrantable(p, input.scopes, input.accountIds, input.allAccounts, input.approvalPolicy);
  if (input.accountIds.length) {
    const found = await prisma().whatsappAccount.count({ where: { id: { in: input.accountIds } } });
    if (found !== input.accountIds.length) throw validationError('One or more account IDs do not exist');
  }
  const secret = randomToken(32);
  const prefix = API_KEY_PREFIX + randomToken(6).replace(/[-_]/g, 'x').slice(0, 8);
  const full = `${prefix}_${secret}`;
  const key = await prisma().apiKey.create({
    data: {
      name: input.name,
      prefix,
      keyHash: sha256(full),
      scopes: [...new Set(input.scopes)],
      accountIds: [...new Set(input.accountIds)],
      allAccounts: input.allAccounts,
      approvalPolicy: input.approvalPolicy,
      expiresAt: input.expiresAt,
      createdById: p.type === 'user' ? p.id : null,
      rotatedFromId: rotatedFromId ?? null,
    },
  });
  await audit({ action: rotatedFromId ? 'api_key.rotated' : 'api_key.created', actor: p, metadata: { apiKeyId: key.id, prefix, scopes: input.scopes, policy: input.approvalPolicy } });
  return { key, secret: full };
}

export async function revokeApiKey(p: Principal, id: string) {
  const key = await prisma().apiKey.findUnique({ where: { id } });
  if (!key) throw notFound('API key');
  const updated = await prisma().apiKey.update({ where: { id }, data: { revokedAt: key.revokedAt ?? new Date() } });
  await audit({ action: 'api_key.revoked', actor: p, metadata: { apiKeyId: id, prefix: key.prefix } });
  return updated;
}

export async function rotateApiKey(p: Principal, id: string) {
  const key = await prisma().apiKey.findUnique({ where: { id } });
  if (!key || key.revokedAt) throw notFound('Active API key');
  const created = await createApiKey(
    p,
    { name: key.name, scopes: key.scopes as string[], accountIds: key.accountIds as string[], allAccounts: key.allAccounts, approvalPolicy: key.approvalPolicy, expiresAt: key.expiresAt },
    key.id,
  );
  await prisma().apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  return created;
}

/** Resolve a presented bearer API key into a principal. */
export async function authenticateApiKey(presented: string, ip?: string): Promise<Principal | null> {
  if (!presented.startsWith(API_KEY_PREFIX) || presented.length > 200) return null;
  const key = await prisma().apiKey.findUnique({ where: { keyHash: sha256(presented) } });
  if (!key || key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt < new Date()) return null;
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 30_000) {
    await prisma().apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip ?? null } }).catch(() => {});
  }
  const principal = apiKeyPrincipal(key);
  principal.ip = ip;
  return principal;
}
