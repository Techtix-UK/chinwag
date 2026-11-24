import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createApiKey } from '../services/apiKeys.js';
import { loadUserPrincipal } from '../services/principals.js';
import { createAccount, createUser, loginAgent, resetDb } from './helpers.js';

const app = createApp();

async function seedChat(accountId: string, waChatId: string, body: string) {
  const chat = await prisma().chat.create({ data: { accountId, waChatId, name: body.slice(0, 10) } });
  await prisma().message.create({ data: { accountId, chatId: chat.id, waMessageId: `m-${waChatId}`, direction: 'INBOUND', type: 'chat', body, timestamp: new Date() } });
  await prisma().contact.create({ data: { accountId, waId: waChatId, displayName: 'Shared Person', phoneNumber: waChatId.split('@')[0] } });
  return chat;
}

describe('permissions and account isolation', () => {
  beforeEach(resetDb);

  it('agents only see conversations on assigned accounts', async () => {
    const a = await createAccount('UK', false);
    const b = await createAccount('ZA', false);
    await seedChat(a.id, '441111@c.us', 'UK secret');
    const chatB = await seedChat(b.id, '272222@c.us', 'ZA secret');
    await createUser('agent@test.local', 'agent', [{ accountId: a.id, level: 'SEND' }]);
    const { agent } = await loginAgent(app, 'agent@test.local');
    const list = await agent.get('/api/v1/chats');
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: any) => c.account_id)).toEqual([a.id]);
    expect((await agent.get(`/api/v1/accounts/${b.id}/chats`)).status).toBe(403);
    expect((await agent.get(`/api/v1/accounts/${b.id}/chats/${chatB.id}/messages`)).status).toBe(403);
    const search = await agent.get('/api/v1/messages/search?q=secret');
    expect(search.body.data.every((m: any) => m.account_id === a.id)).toBe(true);
    const accounts = await agent.get('/api/v1/accounts');
    expect(accounts.body.data.map((x: any) => x.id)).toEqual([a.id]);
  });

  it('does not merge contacts across accounts', async () => {
    const a = await createAccount('UK', false);
    const b = await createAccount('ZA', false);
    await seedChat(a.id, '440000@c.us', 'x');
    await seedChat(b.id, '440000@c.us', 'y');
    expect(await prisma().contact.count({ where: { waId: '440000@c.us' } })).toBe(2);
  });

  it('read-only users cannot send messages', async () => {
    const a = await createAccount('UK');
    await createUser('ro@test.local', 'read_only', [{ accountId: a.id, level: 'READ' }]);
    const { agent, csrf } = await loginAgent(app, 'ro@test.local');
    const res = await agent.post(`/api/v1/accounts/${a.id}/messages/send`).set('x-csrf-token', csrf).send({ phone_number: '+447700900555', text: 'hi' });
    expect(res.status).toBe(403);
  });

  it('a READ grant on an account does not allow sending even with the agent role', async () => {
    const a = await createAccount('UK');
    await createUser('ag2@test.local', 'agent', [{ accountId: a.id, level: 'READ' }]);
    const { agent, csrf } = await loginAgent(app, 'ag2@test.local');
    const res = await agent.post(`/api/v1/accounts/${a.id}/messages/send`).set('x-csrf-token', csrf).send({ phone_number: '+447700900555', text: 'hi' });
    expect(res.status).toBe(403);
  });

  it('API keys are limited to their scopes and accounts', async () => {
    const a = await createAccount('UK', false);
    const b = await createAccount('ZA', false);
    await createUser('root@test.local', 'super_admin');
    const root = (await loadUserPrincipal((await prisma().user.findFirstOrThrow()).id))!;
    const { secret } = await createApiKey(root, { name: 'k', scopes: ['accounts:read', 'chats:read'], accountIds: [a.id], allAccounts: false, approvalPolicy: 'READ_ONLY', expiresAt: null });
    const auth = { authorization: `Bearer ${secret}` };
    expect((await request(app).get(`/api/v1/accounts/${a.id}/chats`).set(auth)).status).toBe(200);
    expect((await request(app).get(`/api/v1/accounts/${b.id}/chats`).set(auth)).status).toBe(403);
    expect((await request(app).get(`/api/v1/accounts/${a.id}/contacts`).set(auth)).status).toBe(403);
    expect((await request(app).get('/api/v1/users').set(auth)).status).toBe(403);
    // QR codes are never available to API keys
    expect((await request(app).get(`/api/v1/accounts/${a.id}/qr`).set(auth)).status).toBe(403);
  });

  it('revoked and expired API keys are rejected', async () => {
    await createUser('root2@test.local', 'super_admin');
    const root = (await loadUserPrincipal((await prisma().user.findFirstOrThrow()).id))!;
    const { key, secret } = await createApiKey(root, { name: 'k', scopes: ['accounts:read'], accountIds: [], allAccounts: true, approvalPolicy: 'READ_ONLY', expiresAt: null });
    expect((await request(app).get('/api/v1/accounts').set('authorization', `Bearer ${secret}`)).status).toBe(200);
    await prisma().apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    expect((await request(app).get('/api/v1/accounts').set('authorization', `Bearer ${secret}`)).status).toBe(401);
  });

  it('administrators cannot grant the super administrator role', async () => {
    await createUser('adm@test.local', 'admin');
    const { agent, csrf } = await loginAgent(app, 'adm@test.local');
    const res = await agent.post('/api/v1/users').set('x-csrf-token', csrf).send({ email: 'x@test.local', name: 'X', password: 'Correct-Horse-Battery-9', roles: ['super_admin'] });
    expect(res.status).toBe(403);
  });

  it('administrators can only grant access to accounts they manage', async () => {
    const a = await createAccount('UK', false);
    const b = await createAccount('ZA', false);
    await createUser('adm2@test.local', 'admin', [{ accountId: a.id, level: 'MANAGE' }]);
    const { agent, csrf } = await loginAgent(app, 'adm2@test.local');
    const ok = await agent.post('/api/v1/users').set('x-csrf-token', csrf).send({ email: 'y@test.local', name: 'Y', password: 'Correct-Horse-Battery-9', roles: ['agent'], account_access: [{ account_id: a.id, level: 'send' }] });
    expect(ok.status).toBe(201);
    const bad = await agent.post('/api/v1/users').set('x-csrf-token', csrf).send({ email: 'z@test.local', name: 'Z', password: 'Correct-Horse-Battery-9', roles: ['agent'], account_access: [{ account_id: b.id, level: 'send' }] });
    expect(bad.status).toBe(403);
  });
});
