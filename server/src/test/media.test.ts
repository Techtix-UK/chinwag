import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { detectMime, safeFilename } from '../services/media.js';
import { setSettingsCache } from '../services/settings.js';
import { clients, createAccount, createUser, loginAgent, resetDb } from './helpers.js';

const app = createApp();
// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

describe('file upload validation', () => {
  beforeEach(resetDb);

  it('detects types from content, not the declared MIME type', async () => {
    expect(await detectMime(PNG, 'application/pdf', 'x.pdf')).toBe('image/png');
    await expect(detectMime(Buffer.from('<html><script>alert(1)</script></html>'), 'text/html', 'x.html')).rejects.toThrow();
    await expect(detectMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), 'image/svg+xml', 'x.svg')).rejects.toThrow();
    expect(await detectMime(Buffer.from('a,b\n1,2\n'), 'text/csv', 'data.csv')).toBe('text/csv');
    await expect(detectMime(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), 'application/octet-stream', 'x.exe')).rejects.toThrow();
  });

  it('sanitises filenames', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('a<b>:c?.pdf')).toBe('a_b_c_.pdf');
    expect(safeFilename('...')).toBe('file');
  });

  it('uploads, stores and serves attachments only to authorised users', async () => {
    const a = await createAccount('UK');
    const b = await createAccount('ZA');
    await createUser('agent@test.local', 'agent', [{ accountId: a.id, level: 'SEND' }]);
    await createUser('other@test.local', 'agent', [{ accountId: b.id, level: 'SEND' }]);
    const { agent, csrf } = await loginAgent(app, 'agent@test.local');
    const up = await agent.post(`/api/v1/accounts/${a.id}/attachments`).set('x-csrf-token', csrf).attach('file', PNG, { filename: 'pixel.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(up.body.data.mime_type).toBe('image/png');
    expect(up.body.data.checksum_sha256).toHaveLength(64);
    const dl = await agent.get(`/api/v1/media/${up.body.data.id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    const { agent: other } = await loginAgent(app, 'other@test.local');
    expect((await other.get(`/api/v1/media/${up.body.data.id}`)).status).toBe(403);
    expect((await request(app).get(`/api/v1/media/${up.body.data.id}`)).status).toBe(401);

    const sent = await agent.post(`/api/v1/accounts/${a.id}/messages/media`).set('x-csrf-token', csrf).send({ chat_id: '447700900555@c.us', attachment_id: up.body.data.id, caption: 'pic' });
    expect(sent.status).toBe(200);
    expect(clients.get(a.id)!.sent[0].content.mimetype).toBe('image/png');
  });

  it('rejects disallowed and oversized uploads', async () => {
    const a = await createAccount('UK');
    await createUser('agent@test.local', 'agent', [{ accountId: a.id, level: 'SEND' }]);
    const { agent, csrf } = await loginAgent(app, 'agent@test.local');
    const html = await agent.post(`/api/v1/accounts/${a.id}/attachments`).set('x-csrf-token', csrf).attach('file', Buffer.from('<html></html>'), { filename: 'x.html', contentType: 'text/html' });
    expect(html.status).toBe(422);
    setSettingsCache({ maxAttachmentMb: 1 });
    const big = await agent.post(`/api/v1/accounts/${a.id}/attachments`).set('x-csrf-token', csrf).attach('file', Buffer.alloc(1024 * 1024 + 10, 1), { filename: 'big.bin', contentType: 'application/pdf' });
    expect(big.status).toBe(413);
  });

  it('blocks attachment URLs pointing at private networks (SSRF)', async () => {
    const a = await createAccount('UK');
    await createUser('agent@test.local', 'agent', [{ accountId: a.id, level: 'SEND' }]);
    const { agent, csrf } = await loginAgent(app, 'agent@test.local');
    for (const url of ['http://127.0.0.1:3306/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://10.0.0.5/x.png']) {
      const res = await agent.post(`/api/v1/accounts/${a.id}/attachments`).set('x-csrf-token', csrf).send({ file_url: url });
      expect(res.status, url).toBe(422);
    }
  });
});
