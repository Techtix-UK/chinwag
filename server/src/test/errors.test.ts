import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { scrub } from '../services/audit.js';
import { prisma } from '../db/prisma.js';
import { createUser, loginAgent, resetDb } from './helpers.js';
import { buildOpenApi } from '../http/openapi.js';

const app = createApp();

describe('error handling, audit and API docs', () => {
  beforeEach(resetDb);

  it('returns consistent JSON errors', async () => {
    const nf = await request(app).get('/api/v1/does-not-exist');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('not_found');
    const unauth = await request(app).get('/api/v1/accounts');
    expect(unauth.status).toBe(401);
    const badJson = await request(app).post('/api/v1/auth/login').set('content-type', 'application/json').send('{bad');
    expect(badJson.status).toBe(400);
    const invalid = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email', password: '' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details.length).toBeGreaterThan(0);
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeTruthy();
  });

  it('never stores secrets or message content in audit metadata', () => {
    const out = scrub({ password: 'x', token: 'y', body: 'hello', text: 'hi', chatId: 'c', nested: { apiKey: 'k', ok: 1 } });
    expect(out).toEqual({ chatId: 'c', nested: { ok: 1 } });
  });

  it('records logins in the activity log', async () => {
    await createUser('a@test.local', 'super_admin');
    await loginAgent(app, 'a@test.local');
    await request(app).post('/api/v1/auth/login').send({ email: 'a@test.local', password: 'bad' });
    const actions = (await prisma().auditLog.findMany()).map((l) => l.action);
    expect(actions).toContain('auth.login');
    expect(actions).toContain('auth.login_failed');
  });

  it('generates an OpenAPI document covering the documented REST endpoints', async () => {
    const doc = buildOpenApi();
    for (const p of ['/api/v1/accounts', '/api/v1/accounts/{accountId}/messages/send', '/api/v1/scheduled-messages/{id}', '/api/v1/health', '/api/v1/system/status', '/api/v1/accounts/{accountId}/chats/unread']) {
      expect(Object.keys(doc.paths)).toContain(p);
    }
    await createUser('d@test.local', 'super_admin');
    const { agent } = await loginAgent(app, 'd@test.local');
    expect((await agent.get('/api/v1/openapi.json')).body.openapi).toBe('3.1.0');
    expect((await request(app).get('/api/docs/')).status).toBe(302);
  });
});
