import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { createScheduled, recoverInterrupted, tick, updateScheduled } from '../services/scheduler.js';
import { decide } from '../services/approvals.js';
import { apiKeyPrincipal, loadUserPrincipal } from '../services/principals.js';
import { setSettingsCache } from '../services/settings.js';
import { parseLocalDateTime } from '../lib/time.js';
import { clients, createAccount, createUser, resetDb } from './helpers.js';

async function root() {
  const u = await createUser('root@test.local', 'super_admin');
  return (await loadUserPrincipal(u.id))!;
}

describe('scheduled messages', () => {
  beforeEach(resetDb);

  it('sends due messages and survives restarts (state is in the database)', async () => {
    const a = await createAccount('UK');
    const p = await root();
    const row = await createScheduled(p, { accountId: a.id, recipientWaId: '447700900555@c.us', recipientLabel: null, body: 'Payment reminder', attachmentId: null, scheduledAt: new Date(Date.now() + 1000), timezone: 'Europe/London' }, 'dashboard');
    expect(row.status).toBe('PENDING');
    await tick(new Date(Date.now() - 1000));
    expect(clients.get(a.id)!.sent).toHaveLength(0);
    await prisma().scheduledMessage.update({ where: { id: row.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await tick();
    const after = await prisma().scheduledMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('SENT');
    expect(after.sentMessageId).toBeTruthy();
    expect(clients.get(a.id)!.sent).toHaveLength(1);
    await tick();
    expect(clients.get(a.id)!.sent).toHaveLength(1);
  });

  it('marks interrupted sends as delivery uncertain and never retries them', async () => {
    const a = await createAccount('UK');
    const row = await prisma().scheduledMessage.create({ data: { accountId: a.id, recipientWaId: '447700900555@c.us', body: 'x', scheduledAt: new Date(Date.now() - 5000), timezone: 'UTC', status: 'PROCESSING', createdByType: 'user', createdById: 'u' } });
    await recoverInterrupted();
    await tick();
    expect((await prisma().scheduledMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('DELIVERY_UNCERTAIN');
    expect(clients.get(a.id)!.sent).toHaveLength(0);
  });

  it('treats send exceptions as delivery uncertain (no automatic retry)', async () => {
    const a = await createAccount('UK');
    const p = await root();
    const row = await createScheduled(p, { accountId: a.id, recipientWaId: '447700900555@c.us', recipientLabel: null, body: 'x', attachmentId: null, scheduledAt: new Date(Date.now() + 2000), timezone: 'UTC' }, 'dashboard');
    await prisma().scheduledMessage.update({ where: { id: row.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    clients.get(a.id)!.failNextSend = new Error('Evaluation failed: timeout');
    await tick();
    expect((await prisma().scheduledMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('DELIVERY_UNCERTAIN');
    await tick();
    expect(clients.get(a.id)!.sent).toHaveLength(0);
  });

  it('waits for a disconnected account and expires after the configured window', async () => {
    const a = await createAccount('Offline', false);
    setSettingsCache({ scheduledExpiryMinutes: 10 });
    const row = await prisma().scheduledMessage.create({ data: { accountId: a.id, recipientWaId: '447700900555@c.us', body: 'x', scheduledAt: new Date(Date.now() - 5 * 60_000), timezone: 'UTC', createdByType: 'user', createdById: 'u' } });
    await tick();
    const waiting = await prisma().scheduledMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(waiting.status).toBe('PENDING');
    expect(waiting.errorDetail).toMatch(/Waiting/);
    await prisma().scheduledMessage.update({ where: { id: row.id }, data: { scheduledAt: new Date(Date.now() - 20 * 60_000) } });
    await tick();
    expect((await prisma().scheduledMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('EXPIRED');
  });

  it('integration schedules require approval, and edits require renewed approval', async () => {
    const a = await createAccount('UK');
    const reviewer = await root();
    const key = apiKeyPrincipal({ id: 'key1', name: 'k', prefix: 'ttw_x', scopes: ['schedule:write', 'schedule:read'], accountIds: [a.id], allAccounts: false, approvalPolicy: 'REQUIRE_APPROVAL' });
    const row = await createScheduled(key, { accountId: a.id, recipientWaId: '447700900555@c.us', recipientLabel: null, body: 'v1', attachmentId: null, scheduledAt: new Date(Date.now() + 60_000), timezone: 'UTC' }, 'api');
    expect(row.status).toBe('AWAITING_APPROVAL');
    const first = row.approvalId!;
    const edited = await updateScheduled(key, row.id, { body: 'v2' }, 'api');
    expect(edited.approvalId).not.toBe(first);
    expect((await prisma().messageApproval.findUniqueOrThrow({ where: { id: first } })).status).toBe('SUPERSEDED');
    await decide(reviewer, edited.approvalId!, 'approve');
    expect((await prisma().scheduledMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
  });

  it('parses local times in the requested timezone', () => {
    expect(parseLocalDateTime('2026-07-01T09:00', 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(parseLocalDateTime('2026-01-15T09:00', 'Europe/London').toISOString()).toBe('2026-01-15T09:00:00.000Z');
    expect(parseLocalDateTime('2026-01-15T09:00', 'Africa/Johannesburg').toISOString()).toBe('2026-01-15T07:00:00.000Z');
    expect(parseLocalDateTime('2026-01-15T09:00:00+02:00', 'Europe/London').toISOString()).toBe('2026-01-15T07:00:00.000Z');
  });
});
