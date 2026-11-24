import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { hmacSha256 } from '../lib/crypto.js';
import { isAddressAllowed } from '../lib/netguard.js';
import { createWebhook, processQueue, signPayload, testWebhook, validateDestination, verifySignature } from '../services/webhooks.js';
import { bus } from '../services/events.js';
import { startWebhookWorker, stopWebhookWorker } from '../services/webhooks.js';
import { loadEnv } from '../config/env.js';
import { resetDb } from './helpers.js';

describe('webhooks', () => {
  beforeEach(resetDb);

  it('signs payloads with HMAC-SHA256 over timestamp and body', () => {
    const t = Math.floor(Date.now() / 1000);
    const sig = signPayload('whsec_test', t, '{"a":1}');
    expect(sig).toBe(`t=${t},v1=${hmacSha256('whsec_test', `${t}.{"a":1}`)}`);
    expect(verifySignature('whsec_test', sig, '{"a":1}')).toBe(true);
    expect(verifySignature('whsec_test', sig, '{"a":2}')).toBe(false);
    expect(verifySignature('other', sig, '{"a":1}')).toBe(false);
    expect(verifySignature('whsec_test', signPayload('whsec_test', t - 3600, '{}'), '{}')).toBe(false);
  });

  it('blocks private, loopback and metadata destinations by default', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1']) expect(isAddressAllowed(ip), ip).toBe(false);
    expect(isAddressAllowed('93.184.216.34')).toBe(true);
    await expect(validateDestination('http://localhost:8080/hook')).rejects.toThrow();
    await expect(validateDestination('ftp://example.com/')).rejects.toThrow();
  });

  describe('delivery (with an allow-listed local receiver)', () => {
    let server: http.Server;
    let port = 0;
    const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
    beforeAll(async () => {
      process.env.WEBHOOK_ALLOWED_PRIVATE_CIDRS = '127.0.0.1/32';
      loadEnv();
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          received.push({ headers: req.headers, body });
          res.statusCode = req.url === '/fail' ? 500 : 200;
          res.end('ok');
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as any).port;
    });
    afterAll(async () => {
      server.close();
      process.env.WEBHOOK_ALLOWED_PRIVATE_CIDRS = '';
      loadEnv();
      stopWebhookWorker();
    });

    it('delivers signed events and records history', async () => {
      const { webhook, secret } = await createWebhook({ name: 'w', url: `http://127.0.0.1:${port}/ok`, events: ['message.received'], accountIds: [], allAccounts: true, enabled: true, createdById: 'u' });
      startWebhookWorker();
      bus.publish({ type: 'message.received', accountId: 'acc1', data: { message: { id: 'm1' } }, webhook: true });
      bus.publish({ type: 'message.sent', accountId: 'acc1', data: {}, webhook: true }); // not subscribed
      await new Promise((r) => setTimeout(r, 300));
      await processQueue();
      const last = received.at(-1)!;
      expect(last.headers['x-techtix-event']).toBe('message.received');
      expect(verifySignature(secret, String(last.headers['x-techtix-signature']), last.body)).toBe(true);
      const deliveries = await prisma().webhookDelivery.findMany({ where: { webhookId: webhook.id } });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].status).toBe('SUCCEEDED');
    });

    it('schedules retries for failed deliveries', async () => {
      const { webhook } = await createWebhook({ name: 'w', url: `http://127.0.0.1:${port}/fail`, events: ['account.connected'], accountIds: [], allAccounts: true, enabled: true, createdById: 'u' });
      const r = await testWebhook(webhook.id);
      expect(r.ok).toBe(false);
      await prisma().webhookDelivery.create({ data: { webhookId: webhook.id, event: 'account.connected', eventId: 'evt_x', payload: {} } });
      await processQueue();
      const d = await prisma().webhookDelivery.findFirstOrThrow({ where: { eventId: 'evt_x' } });
      expect(d.status).toBe('RETRYING');
      expect(d.attempts).toBe(1);
      expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
