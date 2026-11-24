import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { clients, createAccount, createUser, loginAgent, resetDb } from './helpers.js';

const app = createApp();
const MCP_HEADERS = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
let rpcId = 0;
async function call(token: string, name: string, args: Record<string, unknown>) {
  const res = await request(app).post('/mcp').set(MCP_HEADERS).set('authorization', `Bearer ${token}`).send({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } });
  expect(res.status).toBe(200);
  return res.body.result as { structuredContent: any; isError?: boolean };
}

/** Full OAuth flow for a connection with the given confirmation policy. */
async function connect(accountId: string, policy: string, email = 'owner@test.local') {
  if (!(await prisma().user.findUnique({ where: { email } }))) await createUser(email, 'super_admin');
  const reg = await request(app).post('/register').send({ client_name: 'ChatGPT', redirect_uris: ['https://chat.example/cb'], token_endpoint_auth_method: 'none' });
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const scope = 'accounts:read chats:read messages:read messages:send schedule:read schedule:write';
  const auth = await request(app).get('/authorize').query({ response_type: 'code', client_id: reg.body.client_id, redirect_uri: 'https://chat.example/cb', code_challenge: challenge, code_challenge_method: 'S256', scope });
  const reqId = new URL(auth.headers.location, 'http://x').searchParams.get('request')!;
  const { agent, csrf } = await loginAgent(app, email);
  const d = await agent.post(`/api/v1/oauth/requests/${reqId}/decision`).set('x-csrf-token', csrf).send({ approve: true, scopes: scope.split(' '), account_ids: [accountId], approval_policy: policy });
  expect(d.status).toBe(200);
  const code = new URL(d.body.data.redirect_url).searchParams.get('code')!;
  const tok = await request(app).post('/token').type('form').send({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.body.client_id, redirect_uri: 'https://chat.example/cb' });
  return { token: tok.body.access_token as string, agent, csrf };
}

describe('confirming messages in ChatGPT', () => {
  beforeEach(resetDb);

  it('drafts, shows exactly what will be sent, and sends only after confirm_message', async () => {
    const a = await createAccount('UK');
    const { token, agent, csrf } = await connect(a.id, 'CONFIRM_IN_CHAT');
    const draft = await call(token, 'send_message', { account_id: a.id, phone_number: '+44 7700 900555', text: 'Invoice INV-1042 is due tomorrow' });
    expect(draft.structuredContent.status).toBe('confirmation_required');
    expect(draft.structuredContent.sent).toBe(false);
    expect(draft.structuredContent.draft.text).toBe('Invoice INV-1042 is due tomorrow');
    expect(draft.structuredContent.draft.to.phone_number).toBe('+447700900555');
    expect(draft.structuredContent.draft.from_account.name).toBe('UK');
    expect(clients.get(a.id)!.sent).toHaveLength(0);

    // Not in the dashboard review queue, and reviewers cannot approve it.
    expect((await agent.get('/api/v1/approvals?status=pending')).body.data).toHaveLength(0);
    expect((await agent.post(`/api/v1/approvals/${draft.structuredContent.approval_id}/approve`).set('x-csrf-token', csrf).send({})).status).toBe(409);

    const sent = await call(token, 'confirm_message', { approval_id: draft.structuredContent.approval_id });
    expect(sent.structuredContent).toMatchObject({ status: 'sent', sent: true });
    expect(clients.get(a.id)!.sent).toHaveLength(1);
    expect(clients.get(a.id)!.sent[0].content).toBe('Invoice INV-1042 is due tomorrow');

    const again = await call(token, 'confirm_message', { approval_id: draft.structuredContent.approval_id });
    expect(again.isError).toBe(true);
    expect(clients.get(a.id)!.sent).toHaveLength(1);
  });

  it('cancel_message discards the draft without sending', async () => {
    const a = await createAccount('UK');
    const { token } = await connect(a.id, 'CONFIRM_IN_CHAT');
    const draft = await call(token, 'send_message', { account_id: a.id, chat_id: '447700900555@c.us', text: 'x' });
    const c = await call(token, 'cancel_message', { approval_id: draft.structuredContent.approval_id });
    expect(c.structuredContent.status).toBe('cancelled');
    expect((await call(token, 'confirm_message', { approval_id: draft.structuredContent.approval_id })).isError).toBe(true);
    expect(clients.get(a.id)!.sent).toHaveLength(0);
  });

  it('expired drafts cannot be confirmed', async () => {
    const a = await createAccount('UK');
    const { token } = await connect(a.id, 'CONFIRM_IN_CHAT');
    const draft = await call(token, 'send_message', { account_id: a.id, chat_id: '447700900555@c.us', text: 'x' });
    await prisma().messageApproval.update({ where: { id: draft.structuredContent.approval_id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await call(token, 'confirm_message', { approval_id: draft.structuredContent.approval_id });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.code).toBe('confirmation_expired');
    expect(clients.get(a.id)!.sent).toHaveLength(0);
  });

  it('another connection cannot confirm someone else\'s draft', async () => {
    const a = await createAccount('UK');
    const first = await connect(a.id, 'CONFIRM_IN_CHAT');
    const second = await connect(a.id, 'CONFIRM_IN_CHAT');
    const draft = await call(first.token, 'send_message', { account_id: a.id, chat_id: '447700900555@c.us', text: 'x' });
    const r = await call(second.token, 'confirm_message', { approval_id: draft.structuredContent.approval_id });
    expect(r.isError).toBe(true);
    expect(clients.get(a.id)!.sent).toHaveLength(0);
  });

  it('"ChatGPT or dashboard" drafts can be approved by a reviewer too', async () => {
    const a = await createAccount('UK');
    const { token, agent, csrf } = await connect(a.id, 'CONFIRM_IN_CHAT_OR_DASHBOARD');
    const draft = await call(token, 'send_message', { account_id: a.id, chat_id: '447700900555@c.us', text: 'either' });
    expect(draft.structuredContent.status).toBe('confirmation_required');
    expect(draft.structuredContent.draft.also_approvable_in_dashboard).toBe(true);
    expect((await agent.get('/api/v1/approvals?status=pending')).body.data).toHaveLength(1);
    const ok = await agent.post(`/api/v1/approvals/${draft.structuredContent.approval_id}/approve`).set('x-csrf-token', csrf).send({});
    expect(ok.body.data.status).toBe('executed');
    expect(clients.get(a.id)!.sent).toHaveLength(1);
  });

  it('scheduled messages are activated by confirm_message', async () => {
    const a = await createAccount('UK');
    const { token } = await connect(a.id, 'CONFIRM_IN_CHAT');
    const draft = await call(token, 'schedule_message', { account_id: a.id, chat_id: '447700900555@c.us', text: 'Reminder', scheduled_at: '2030-01-01T09:00', timezone: 'Europe/London' });
    expect(draft.structuredContent.status).toBe('confirmation_required');
    expect(draft.structuredContent.draft.scheduled_for.utc).toBe('2030-01-01T09:00:00.000Z');
    const r = await call(token, 'confirm_message', { approval_id: draft.structuredContent.approval_id });
    expect(r.structuredContent.status).toBe('scheduled');
    expect((await prisma().scheduledMessage.findFirstOrThrow()).status).toBe('PENDING');
  });

  it('dashboard-approval connections still route to the review queue', async () => {
    const a = await createAccount('UK');
    const { token } = await connect(a.id, 'REQUIRE_APPROVAL');
    const r = await call(token, 'send_message', { account_id: a.id, chat_id: '447700900555@c.us', text: 'x' });
    expect(r.structuredContent.status).toBe('pending_approval');
    expect((await call(token, 'confirm_message', { approval_id: r.structuredContent.approval_id })).isError).toBe(true);
  });
});
