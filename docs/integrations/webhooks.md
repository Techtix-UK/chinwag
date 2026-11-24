# Webhooks

Configure under **Webhooks**: destination URL, events, accounts, enabled. Each webhook gets a signing secret (shown once; rotate any time).

## Events

`message.received` · `message.sent` · `message.delivered` · `message.read` · `message.failed` · `account.connected` · `account.disconnected` · `account.authentication_failed` · `scheduled_message.sent` · `scheduled_message.failed` · `approval.requested` · `approval.completed`

## Request

```http
POST /your/endpoint
Content-Type: application/json
X-Chinwag-Event: message.received
X-Chinwag-Event-Id: evt_…          # deduplicate on this
X-Chinwag-Timestamp: 1795540000
X-Chinwag-Signature: t=1795540000,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>

{ "id": "evt_…", "type": "message.received", "created_at": "…", "account_id": "…", "data": { … } }
```

## Verifying signatures

```js
import crypto from 'node:crypto';

export function verifyChinwag(secret, header, rawBody) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // reject replays
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

## Delivery

Respond with any 2xx within 10 seconds. Failures are retried after 30 s, 2 min, 10 min, 30 min and 2 h, then marked failed (visible in System Health). Every attempt is recorded in the webhook's **Deliveries** history, where you can also redeliver.

Destinations on localhost, private networks or cloud metadata addresses are blocked unless allowed with `WEBHOOK_ALLOWED_PRIVATE_CIDRS`. In production, destinations must use HTTPS.
