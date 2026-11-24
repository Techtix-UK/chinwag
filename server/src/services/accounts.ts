import { prisma } from '../db/prisma.js';
import { notFound } from '../lib/errors.js';
import { sessionManager } from '../whatsapp/manager.js';
import { serializeAccount } from './serializers.js';
import { audit } from './audit.js';
import { removeAccountMedia } from './media.js';
import { accountFilter, assertCan, type Principal } from './permissions.js';

export async function listAccounts(p: Principal) {
  const filter = accountFilter(p, 'accounts:read');
  const rows = await prisma().whatsappAccount.findMany({ where: filter ? { id: filter } : {}, orderBy: { createdAt: 'asc' } });
  return rows.map((a) => withLive(a));
}

export function withLive(a: Parameters<typeof serializeAccount>[0]) {
  const snap = sessionManager().snapshot(a.id);
  return serializeAccount(a, snap ? { status: snap.status, ready: snap.ready, statusDetail: snap.statusDetail } : undefined);
}

export async function getAccount(p: Principal, accountId: string) {
  assertCan(p, 'accounts:read', accountId);
  const a = await prisma().whatsappAccount.findUnique({ where: { id: accountId } });
  if (!a) throw notFound('WhatsApp account');
  return a;
}

export async function accountStatus(p: Principal, accountId: string) {
  const a = await getAccount(p, accountId);
  const snap = sessionManager().snapshot(accountId);
  const session = await prisma().whatsappSession.findUnique({ where: { accountId } });
  return {
    account_id: a.id,
    status: (snap?.status ?? a.status).toLowerCase(),
    status_detail: snap?.statusDetail ?? a.statusDetail,
    ready: snap?.ready ?? false,
    desired_state: a.desiredState.toLowerCase(),
    awaiting_qr: !!snap?.hasQr,
    reconnect_attempts: snap?.retries ?? session?.reconnectAttempts ?? 0,
    last_connected_at: a.lastConnectedAt?.toISOString() ?? null,
    last_disconnected_at: a.lastDisconnectedAt?.toISOString() ?? null,
    last_sync_at: a.lastSyncAt?.toISOString() ?? null,
  };
}

export async function createAccount(p: Principal, displayName: string, connect = true) {
  assertCan(p, 'accounts:manage');
  const account = await prisma().$transaction(async (tx) => {
    const a = await tx.whatsappAccount.create({ data: { displayName: displayName.trim(), desiredState: connect ? 'CONNECTED' : 'DISCONNECTED', status: connect ? 'INITIALISING' : 'DISCONNECTED' } });
    // The creator can manage the account they created.
    if (p.type === 'user' && !p.isSuperAdmin) {
      await tx.userAccountPermission.create({ data: { userId: p.id, accountId: a.id, level: 'MANAGE' } });
      if (p.accountAccess !== 'all') p.accountAccess.set(a.id, 'MANAGE');
    }
    return a;
  });
  await audit({ action: 'account.created', actor: p, accountId: account.id, metadata: { displayName } });
  if (connect) await sessionManager().start(account.id, 'created');
  return account;
}

export async function renameAccount(p: Principal, accountId: string, displayName: string) {
  assertCan(p, 'accounts:manage', accountId);
  const a = await prisma().whatsappAccount.update({ where: { id: accountId }, data: { displayName: displayName.trim() } });
  await audit({ action: 'account.renamed', actor: p, accountId, metadata: { displayName } });
  return a;
}

export async function accountAction(p: Principal, accountId: string, action: 'connect' | 'disconnect' | 'restart' | 'logout' | 'reauthenticate') {
  assertCan(p, 'accounts:manage', accountId);
  await getAccount(p, accountId);
  const m = sessionManager();
  if (action === 'connect') await m.connect(accountId);
  else if (action === 'disconnect') await m.disconnect(accountId);
  else if (action === 'restart') await m.restart(accountId);
  else if (action === 'logout') await m.logout(accountId);
  else await m.reauthenticate(accountId);
  await audit({ action: `account.${action}`, actor: p, accountId });
  return accountStatus(p, accountId);
}

export async function removeAccount(p: Principal, accountId: string) {
  assertCan(p, 'accounts:manage', accountId);
  const a = await getAccount(p, accountId);
  await sessionManager().remove(accountId);
  await removeAccountMedia(accountId);
  await prisma().whatsappAccount.delete({ where: { id: accountId } });
  await audit({ action: 'account.removed', actor: p, accountId, metadata: { displayName: a.displayName } });
}
