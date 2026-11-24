# REST API

Base URL `https://your-host/api/v1`. The interactive reference (Swagger UI) is at `/api/docs` once you're signed in; the raw OpenAPI 3.1 document is at `/api/v1/openapi.json`.

## Authentication

Create keys under **API Credentials** with a name, scopes, accounts, outbound policy and optional expiry. The full key is shown once and stored only as a hash.

```
Authorization: Bearer cwk_xxxxxxxx_…
```

## Conventions

- Success: `{ "data": …, "meta": { "pagination": { "total", "limit", "offset", "has_more" } } }`
- Errors: `{ "error": { "code", "message", "details" } }`
- Chats accept the internal ID or the WhatsApp chat ID (`447700900123@c.us`, `…@g.us`).
- `Idempotency-Key` on outbound requests: the same key and body replays the stored response and never sends twice.
- Rate limited per key (Settings → API rate limit).

## Sending

| HTTP | `data.status` | Meaning |
|---|---|---|
| 200 | `sent` | Accepted by WhatsApp |
| 202 | `pending_approval` | **Not sent** — awaiting dashboard approval |
| 409 | `ambiguous_recipient` | Not sent — see `error.details.candidates` |
| 422 | `not_on_whatsapp` | Number not on WhatsApp |
| 503 | `unavailable` | Account not connected |
| 502 | `delivery_uncertain` | Check the chat before retrying |

## Endpoints

| Area | Endpoints |
|---|---|
| Accounts | `GET/POST /accounts`, `GET/PATCH/DELETE /accounts/:id`, `GET /accounts/:id/status`, `POST /accounts/:id/{connect,disconnect,restart,logout,reauthenticate}` |
| Conversations | `GET /accounts/:id/chats`, `…/chats/unread`, `…/chats/:chatId`, `…/chats/:chatId/messages`, `POST …/chats/:chatId/read`, `POST …/chats/:chatId/backfill`, `GET /accounts/:id/messages/search`, `GET /chats`, `GET /messages/search`, `GET /messages/recent` |
| Contacts | `GET /accounts/:id/contacts`, `…/contacts/search`, `…/contacts/:contactId`, `…/contacts/check`, `PUT …/tags`, `POST …/notes` |
| Messaging | `POST /accounts/:id/messages/{send,reply,media,react}`, `POST /accounts/:id/attachments`, `GET /media/:id`, `POST /media/:id/fetch` |
| Scheduling | `GET/POST /scheduled-messages`, `GET/PATCH/DELETE /scheduled-messages/:id` |
| Groups | `GET /accounts/:id/groups`, `…/groups/:chatId/participants` |
| System | `GET /health`, `GET /system/status` |

## Examples

```bash
curl -s https://your-host/api/v1/accounts -H "Authorization: Bearer $KEY"

curl -s -X POST https://your-host/api/v1/accounts/$ACC/messages/send \
  -H "Authorization: Bearer $KEY" -H "Idempotency-Key: invoice-1042" -H 'content-type: application/json' \
  -d '{"phone_number":"+44 7700 900123","text":"Your invoice INV-1042 is due tomorrow."}'

curl -s -X POST https://your-host/api/v1/accounts/$ACC/messages/media \
  -H "Authorization: Bearer $KEY" -F chat_id=447700900123@c.us -F caption="Invoice" -F file=@INV-1042.pdf

curl -s -X POST https://your-host/api/v1/scheduled-messages \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"account_id":"'$ACC'","phone_number":"+27821234567","text":"Payment reminder","scheduled_at":"2026-12-01T09:00","timezone":"Africa/Johannesburg"}'
```
