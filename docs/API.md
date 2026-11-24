# REST API

Base URL `https://whatsapp.techtixglobal.com/api/v1`. Interactive reference: `/api/docs` (dashboard sign-in
required); raw OpenAPI 3.1: `/api/v1/openapi.json`. The document is generated from the same Zod schemas that
validate requests.

## Authentication

```
Authorization: Bearer ttw_xxxxxxxx_…
```

Create keys under **API Credentials**: name, scopes, accounts, outbound policy (read-only / require approval /
direct), optional expiry. Keys are shown once, stored as SHA-256 hashes, and can be rotated or revoked instantly.
Every API-key request is recorded in the activity log.

## Conventions

- Success: `{ "data": … , "meta": { "pagination": { "total", "limit", "offset", "has_more" } } }`
- Errors: `{ "error": { "code", "message", "details" } }` with 400/401/403/404/409/413/422/423/429/503.
- Pagination: `limit` (≤200) and `offset`; messages use `before=<message id>` cursors.
- IDs: chats accept the internal ID or the WhatsApp chat ID (`447700900123@c.us`, `…@g.us`).
- Rate limit: per key per minute (Settings). `RateLimit-*` headers are returned.
- Outbound endpoints accept `Idempotency-Key`. Same key + same body replays the stored response
  (`meta.idempotent_replay: true`); same key + different body → 422; in progress → 409.

## Outbound semantics

| HTTP | `data.status` | Meaning |
|---|---|---|
| 200 | `sent` | WhatsApp accepted the message (`wa_message_id` returned) |
| 202 | `pending_approval` | **Not sent** — awaiting approval (`approval_id`) |
| 409 | `ambiguous_recipient` | Not sent — choose from `error.details.candidates` |
| 422 | `not_on_whatsapp` | Number cannot be resolved |
| 503 | `unavailable` | Account not connected; nothing sent |
| 502 | `delivery_uncertain` | Send call failed after dispatch; check the chat before retrying |

## Endpoints

Accounts: `GET/POST /accounts`, `GET/PATCH/DELETE /accounts/:id`, `GET /accounts/:id/status`,
`POST /accounts/:id/{connect,disconnect,restart,logout,reauthenticate}`.

Conversations: `GET /accounts/:id/chats`, `GET /accounts/:id/chats/unread`, `GET /accounts/:id/chats/:chatId`,
`GET /accounts/:id/chats/:chatId/messages`, `POST /accounts/:id/chats/:chatId/read`,
`POST /accounts/:id/chats/:chatId/backfill`, `GET /accounts/:id/messages/search?q=`, `GET /chats`,
`GET /messages/search`, `GET /messages/recent`, `GET /accounts/:id/groups`, `GET /accounts/:id/groups/:chatId/participants`.

Contacts: `GET /accounts/:id/contacts`, `GET /accounts/:id/contacts/search?q=`, `GET /accounts/:id/contacts/:contactId`,
`GET /accounts/:id/contacts/check?phone_number=`, `PUT …/tags`, `POST …/notes`, `GET /contacts`.

Messaging: `POST /accounts/:id/messages/send`, `…/reply`, `…/media` (multipart `file` or JSON `attachment_id` /
`file_url` / `file_base64`), `…/react`; `POST /accounts/:id/attachments`; `GET /media/:id`; `POST /media/:id/fetch`.

Scheduling: `GET/POST /scheduled-messages`, `GET/PATCH/DELETE /scheduled-messages/:id`.

Approvals: `GET /approvals/:id` (requesters may poll their own).

System: `GET /health` (public, minimal), `GET /system/status` (`system:read`).

## Examples

```bash
curl -s https://whatsapp.techtixglobal.com/api/v1/accounts -H "Authorization: Bearer $KEY"

curl -s -X POST https://whatsapp.techtixglobal.com/api/v1/accounts/$ACC/messages/send \
  -H "Authorization: Bearer $KEY" -H "Idempotency-Key: invoice-1042-reminder" -H 'content-type: application/json' \
  -d '{"phone_number":"+44 7700 900123","text":"Your invoice INV-1042 is due tomorrow."}'

curl -s -X POST https://whatsapp.techtixglobal.com/api/v1/accounts/$ACC/messages/media \
  -H "Authorization: Bearer $KEY" -F chat_id=447700900123@c.us -F caption="Invoice" -F file=@INV-1042.pdf

curl -s -X POST https://whatsapp.techtixglobal.com/api/v1/scheduled-messages \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"account_id":"'$ACC'","phone_number":"+27821234567","text":"Payment reminder","scheduled_at":"2026-12-01T09:00","timezone":"Africa/Johannesburg"}'
```

## Webhooks

Events: `message.received message.sent message.delivered message.read message.failed account.connected
account.disconnected account.authentication_failed scheduled_message.sent scheduled_message.failed
approval.requested approval.completed`.

Body: `{ "id": "evt_…", "type": "...", "created_at": "...", "account_id": "...", "data": { … } }`.
Headers: `X-Techtix-Event`, `X-Techtix-Event-Id` (deduplicate), `X-Techtix-Timestamp`,
`X-Techtix-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.

```js
import crypto from 'node:crypto';
function verify(secret, header, rawBody) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

Non-2xx responses are retried after 30 s, 2 min, 10 min, 30 min and 2 h, then marked failed (logged and shown
in System Health). Respond within 10 seconds.
