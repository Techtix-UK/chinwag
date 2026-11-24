import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { clientFromMetadataDocument } from '../oauth/provider.js';
import { createAccount, createUser, loginAgent, resetDb } from './helpers.js';

const app = createApp();
const CLIENT_ID = 'https://chatgpt.com/oauth/Nr90eJ5ZhkWm/client.json';
// Shape of ChatGPT's published client metadata document (November 2026).
const CHATGPT_DOC = {
  client_id: CLIENT_ID,
  client_uri: 'https://chatgpt.com/',
  redirect_uris: ['https://chatgpt.com/connector/oauth/Nr90eJ5ZhkWm'],
  token_endpoint_auth_method: 'private_key_jwt',
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  client_name: 'ChatGPT',
  logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png',
  token_endpoint_auth_signing_alg: 'RS256',
  jwks_uri: 'https://chatgpt.com/oauth/jwks.json',
};

describe('Client ID Metadata Documents (ChatGPT)', () => {
  beforeEach(resetDb);

  it('accepts ChatGPT\'s document as a PKCE public client', () => {
    const c = clientFromMetadataDocument(CLIENT_ID, CHATGPT_DOC);
    expect(c.tokenEndpointAuthMethod).toBe('none');
    expect(c.redirectUris).toEqual(['https://chatgpt.com/connector/oauth/Nr90eJ5ZhkWm']);
    expect(c.clientName).toBe('ChatGPT');
  });

  it('rejects mismatched, non-https or confidential-only documents', () => {
    expect(() => clientFromMetadataDocument(CLIENT_ID, { ...CHATGPT_DOC, client_id: 'https://evil.example/c.json' })).toThrow();
    expect(() => clientFromMetadataDocument(CLIENT_ID, { ...CHATGPT_DOC, redirect_uris: ['http://chatgpt.com/cb'] })).toThrow();
    expect(() => clientFromMetadataDocument(CLIENT_ID, { ...CHATGPT_DOC, token_endpoint_auth_methods_supported: ['private_key_jwt'] })).toThrow();
  });

  it('completes the authorization code flow with a URL client_id (even if the client sends a client_assertion)', async () => {
    const a = await createAccount('UK');
    await createUser('owner@test.local', 'super_admin');
    // Simulate a freshly fetched (cached) metadata document so no outbound request is needed.
    await prisma().oAuthClient.create({ data: { clientId: CLIENT_ID, ...clientFromMetadataDocument(CLIENT_ID, CHATGPT_DOC) } as any });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const auth = await request(app).get('/authorize').query({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: CHATGPT_DOC.redirect_uris[0], code_challenge: challenge, code_challenge_method: 'S256',
      scope: 'accounts:read chats:read', state: 's1', resource: 'http://localhost:3999/mcp', ui_locales: 'en-US',
    });
    expect(auth.status).toBe(302);
    expect(auth.headers.location).toMatch(/^\/oauth\/consent\?request=/);
    const reqId = new URL(auth.headers.location, 'http://x').searchParams.get('request')!;
    const { agent, csrf } = await loginAgent(app, 'owner@test.local');
    const decision = await agent.post(`/api/v1/oauth/requests/${reqId}/decision`).set('x-csrf-token', csrf).send({ approve: true, scopes: ['accounts:read', 'chats:read'], account_ids: [a.id] });
    const code = new URL(decision.body.data.redirect_url).searchParams.get('code')!;
    const tok = await request(app).post('/token').type('form').send({
      grant_type: 'authorization_code', code, code_verifier: verifier, client_id: CLIENT_ID, redirect_uri: CHATGPT_DOC.redirect_uris[0],
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: 'ignored.jwt.value',
    });
    expect(tok.status).toBe(200);
    expect(tok.body.access_token).toMatch(/^cwa_/);
  });
});
