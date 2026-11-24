import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createUser, loginAgent, resetDb } from './helpers.js';
import { passwordProblems } from '../services/passwords.js';

const app = createApp();

describe('authentication', () => {
  beforeEach(resetDb);

  it('logs in with valid credentials and returns the current user', async () => {
    await createUser('admin@test.local', 'super_admin');
    const { agent } = await loginAgent(app, 'admin@test.local');
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('admin@test.local');
    expect(me.body.data.is_super_admin).toBe(true);
  });

  it('sets a secure HTTP-only session cookie', async () => {
    await createUser('a@test.local', 'agent');
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@test.local', password: 'Correct-Horse-Battery-9' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/ttw_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('rejects wrong passwords and unknown users with the same error', async () => {
    await createUser('b@test.local', 'agent');
    const a = await request(app).post('/api/v1/auth/login').send({ email: 'b@test.local', password: 'wrong-password' });
    const b = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@test.local', password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.code).toBe(b.body.error.code);
  });

  it('locks the account after repeated failures (brute-force protection)', async () => {
    await createUser('c@test.local', 'agent');
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/login').send({ email: 'c@test.local', password: 'nope' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'c@test.local', password: 'Correct-Horse-Battery-9' });
    expect(res.status).toBe(423);
    const u = await prisma().user.findUniqueOrThrow({ where: { email: 'c@test.local' } });
    expect(u.lockedUntil).not.toBeNull();
  });

  it('stores Argon2id password hashes', async () => {
    const u = await createUser('d@test.local', 'agent');
    expect(u.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('requires a CSRF token for cookie-authenticated writes', async () => {
    await createUser('e@test.local', 'super_admin');
    const { agent, csrf } = await loginAgent(app, 'e@test.local');
    const without = await agent.post('/api/v1/accounts').send({ display_name: 'X', connect: false });
    expect(without.status).toBe(403);
    const withToken = await agent.post('/api/v1/accounts').set('x-csrf-token', csrf).send({ display_name: 'X', connect: false });
    expect(withToken.status).toBe(201);
  });

  it('rejects cross-origin writes even with a token', async () => {
    await createUser('f@test.local', 'super_admin');
    const { agent, csrf } = await loginAgent(app, 'f@test.local');
    const res = await agent.post('/api/v1/accounts').set('x-csrf-token', csrf).set('origin', 'https://evil.example').send({ display_name: 'X', connect: false });
    expect(res.status).toBe(403);
  });

  it('expires sessions and logs out', async () => {
    await createUser('g@test.local', 'agent');
    const { agent, csrf } = await loginAgent(app, 'g@test.local');
    await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrf);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    const { agent: a2 } = await loginAgent(app, 'g@test.local');
    await prisma().userSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await a2.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('enforces password strength', () => {
    expect(passwordProblems('short', 12)).not.toHaveLength(0);
    expect(passwordProblems('alllowercaseletters', 12)).not.toHaveLength(0);
    expect(passwordProblems('Str0ng-Enough-Pass', 12)).toHaveLength(0);
  });

  it('blocks the integration client role from the dashboard API', async () => {
    await createUser('ic@test.local', 'integration_client');
    const { agent } = await loginAgent(app, 'ic@test.local');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    expect((await agent.get('/api/v1/accounts')).status).toBe(403);
  });
});
