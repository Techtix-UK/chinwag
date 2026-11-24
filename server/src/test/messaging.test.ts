import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createApiKey } from '../services/apiKeys.js';
import { loadUserPrincipal } from '../services/principals.js';
import { upsertMessage } from '../whatsapp/sync.js';
import { clients, createAccount, createUser, loginAgent, resetDb } from './helpers.js';

const app = createApp();

async function rootPrincipal() {
  await createUser('root@test.local', 'super_admin');
  return (await loadUserPrincipal((await prisma().user.findFirstOrThrow({ where: { email: 'root@test.local' } })).id))!;
}

describe('REST messaging, approvals and idempotency', () => {
  beforeEach(resetDb);

  it('dashboard users send directly and the message is stored', async () => {
    const a = await createAccount('UK');
    await createUser('agent@test.local', 'agent', [{ accountId: a.id, level: 'SEND' }]);
    const { agent, csrf } = await loginAgent(app, 'agent@test.local');
    const res = await agent.post(`/api/v1/accounts/${a.id}/messages/send`).set('x-csrf-token', csrf).send({ phone_number: '+44 7700 900555', text: 'Hello there' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('sent');
    expect(clients.get(a.id)!.sent).toHaveLength(1);
    expect(clients.get(a.id)!.sent[0].chatId).toBe('447700900555@c.us');
    const stored = await prisma().message.findFirstOrThrow({ where: { accountId: a.id, direction: 'OUTBOUND' } });
    expect(stored.body).toBe('Hello there');
    expect(stored.sentVia).toBe('dashboard');
  });

  it('rejects numbers that are not on WhatsApp and local-format numbers', async () => {
    const a = await createAccount('UK');
    const root = await rootPrincipal();
    const { secret } = await createApiKey(root, { name: 'k', scopes: ['messages:send'], accountIds: [a.id], allAccounts: false, approvalPolicy: 'DIRECT', expiresAt: null });
    const r1 = await request(app).post(`/api/v1/accounts/${a.id}/messages/send`).set('authorization', `Bearer ${secret}`).send({ phone_number: '+999 123 4567 89', text: 'x' });
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe('not_on_whatsapp');
    const r2 = await request(app).post(`/api/v1/accounts/${a.id}/messages/send`).set('authorization', `Bearer ${secret}`).send({ phone_number: '07700 900555', text: 'x' });
    expect(r2.status).toBe(422);
    expect(clients.get(a.id)!.sent).toHaveLength(0);
  });

  it('returns candidates instead of guessing an ambiguous recipient', async () => {
    const a = await createAccount('UK');
    await prisma().contact.createMany({ data: [{ accountId: a.id, waId: '441@c.us', displayName: 'John Smith' }, { accountId: a.id, waId: '442@c.us', displayName: 'John Smithers' }] });
    const root = await rootPrincipal();
    const { secret } = await createApiKey(root, { name: 'k', scopes: ['messages:send'], accountIds: [a.id], allAccounts: false, approvalPolicy: 'DIRECT', expiresAt: null });
    const res = await request(app).post(`/api/v1/accounts/${a.id}/messages/send`).set('authorization', `Bearer ${secret}`).send({ name: 'John', text: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ambiguous_recipient');
    expect(res.body.error.details.candidates).toHaveLength(2);
    expect(clients.get(a.id)!.sent).toHaveLength(0);
  });

  it('integrations requiring approval are queued, not sent, and approval sends the exact payload', async () => {
    const a = await createAccount('UK');
    const root = await rootPrincipal();
    const { secret } = await createApiKey(root, { name: 'k', scopes: ['messages:send'], accountIds: [a.id], allAccounts: false, approvalPolicy: 'REQUIRE_APPROVAL', expiresAt: null });
    const res = await request(app).post(`/api/v1/accounts/${a.id}/messages/send`).set('authorization', `Bearer ${secret}`).send({ phone_number: '+447700900555', text: 'Invoice reminder' });
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('pending_approval');
    expect(clients.get(a.id)!.sent).toHaveLength(0);

    const { agent, csrf } = await loginAgent(app, 'root@test.local');
    const approved = await agent.post(`/api/v1/approvals/${res.body.data.approval_id}/approve`).set('x-csrf-token', csrf).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('executed');
    expect(clients.get(a.id)!.sent).toHaveLength(1);
    expect(clients.get(a.id)!.sent[0].content).toBe('Invoice reminder');
    // cannot approve twice
    expect((await agent.post(`/api/v1/approvals/${res.body.data.approval_id}/approve`).set('x-csrf-token', csrf).send({})).status).toBe(409);
  });

  it('refuses to execute an approval whose payload was modified', async () => {
    const a = await createAccount('UK');
    const root = await rootPrincipal();
    const { secret } = await createApiKey(root, { name: 'k', scopes: ['messages:send'], accountIds: [a.id], allAccounts: false, approvalPolicy: 'REQUIRE_APPROVAL', expiresAt: null });
    const res = await request(app).post(`/api/v1/accounts/${a.id}/messages/send`).set('authorization', `Bearer ${secret}`).send({ phone_number: '+447700900555', text: 'Original' });
    const approval = await prisma().messageApproval.findUniqueOrThrow({ where: { id: res.body.data.approval_id } });
    await prisma().messageApproval.update({ where: { id: approval.id }, data: { payload: { ...(approval.payload as any), text: 'Tampered' } } });
    const { agent, csrf } = await loginAgent(app, 'root@test.local');
    const r = await agent.post(`/api/v1/approvals/${approval.id}/approve`).set('x-csrf-token', csrf).send({});
    expect(r.status).toBe(409);
    expect(clients.get(a.id)!.sent).toHaveLength(0);
  });

  it('read-only integrations cannot send', async () => {
    const a = await createAccount('UK');
    const root = await rootPrincipal();
    const { secret } = await createApiKey(root, { name: 'k', scopes: ['messages:send'], accountIds: [a.id], allAccounts: false, approvalPolicy: 'READ_ONLY', expiresAt: null });
    const res = await request(app).post(`/api/v1/accounts/${a.id}/messages/send`).set('authorization', `Bearer ${secret}`).send({ phone_number: '+447700900555', text: 'x' });
    expect(res.status).toBe(403);
  });

  it('idempotency keys prevent duplicate sends', async () => {
    const a = await createAccount('UK');
    const root = await rootPrincipal();
    const { secret } = await createApiKey(root, { name: 'k', scopes: ['messages:send'], accountIds: [a.id], allAccounts: false, approvalPolicy: 'DIRECT', expiresAt: null });
    const send = (text: string) => request(app).post(`/api/v1/accounts/${a.id}/messages/send`).set('authorization', `Bearer ${secret}`).set('idempotency-key', 'order-42').send({ phone_number: '+447700900555', text });
    const r1 = await send('once');
    const r2 = await send('once');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.body.meta.idempotent_replay).toBe(true);
    expect(clients.get(a.id)!.sent).toHaveLength(1);
    const r3 = await send('different body');
    expect(r3.status).toBe(422);
  });

  it('returns 503 when the account is not connected', async () => {
    const a = await createAccount('Offline', false);
    await createUser('ag@test.local', 'agent', [{ accountId: a.id, level: 'SEND' }]);
    const { agent, csrf } = await loginAgent(app, 'ag@test.local');
    const res = await agent.post(`/api/v1/accounts/${a.id}/messages/send`).set('x-csrf-token', csrf).send({ chat_id: '447700900555@c.us', text: 'x' });
    expect(res.status).toBe(503);
  });

  it('prevents duplicate messages from repeated WhatsApp events', async () => {
    const a = await createAccount('UK');
    const c = clients.get(a.id)!;
    const msg = c.fakeMessage('447700900777@c.us', 'dup', false, 'false_447700900777@c.us_ABC');
    const r1 = await upsertMessage(a.id, msg as any, { live: true });
    const r2 = await upsertMessage(a.id, msg as any, { live: true });
    expect(r1?.created).toBe(true);
    expect(r2?.created).toBe(false);
    expect(await prisma().message.count({ where: { accountId: a.id } })).toBe(1);
    // The same WhatsApp message ID on a different account is a separate record.
    const b = await createAccount('ZA');
    await upsertMessage(b.id, msg as any, { live: true });
    expect(await prisma().message.count({ where: { waMessageId: 'false_447700900777@c.us_ABC' } })).toBe(2);
  });

  it('incoming messages increment unread counts and update the chat preview', async () => {
    const a = await createAccount('UK');
    const c = clients.get(a.id)!;
    c.emit('message_create', c.fakeMessage('447700900888@c.us', 'First', false));
    c.emit('message_create', c.fakeMessage('447700900888@c.us', 'Second', false));
    await new Promise((r) => setTimeout(r, 300));
    const chat = await prisma().chat.findFirstOrThrow({ where: { accountId: a.id, waChatId: '447700900888@c.us' } });
    expect(chat.unreadCount).toBe(2);
    expect(chat.lastMessagePreview).toBe('Second');
  });
});
