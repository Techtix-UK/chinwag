# Techtix WhatsApp

Self-hosted administration platform, REST API and remote MCP server for managing multiple WhatsApp
accounts through **WhatsApp Web linked-device sessions**. Developed by **Techtix Global**.

> **Unofficial integration.** Techtix WhatsApp uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js),
> an unofficial library that automates WhatsApp Web in Chromium. It is not affiliated with, endorsed by or a
> product of WhatsApp or Meta. WhatsApp Web changes can break it without notice and WhatsApp may restrict
> accounts it considers automated. No Meta Business API, Cloud API, developer account or access token is used.
> Do not use it for unsolicited or bulk messaging.

## Features

| Area | What you get |
|---|---|
| Accounts | Unlimited\* simultaneous accounts, QR pairing with live refresh, isolated `LocalAuth` session per account, connect / disconnect / restart / re-authenticate / log out / remove, diagnostics and per-session Chromium resource usage, controlled auto-recovery with back-off and a hard retry limit |
| Inbox | Real-time conversation list and chat view (Socket.IO), filters (unread, individuals, groups, archived, account), search by name / number / group / synchronised message text, media (images, video, audio, voice notes, documents, stickers, locations), quoted replies, reactions, delivery/read ticks, lazy history loading plus "load older from WhatsApp", drafts, emoji, attachments, scheduling |
| Sync | Chats, contacts, messages, acks, edits, deletions, reactions, group metadata and participants; duplicate-safe on `(account_id, wa_message_id)`; per-chat sync state (full / partial / unavailable); configurable initial limits and automatic media download |
| Contacts | Per-account directory (never merged across accounts), tags, notes, WhatsApp number validation |
| Scheduling | Database-backed scheduler (no Redis), survives restarts, edit / reschedule / cancel, expiry policy for disconnected accounts, *never* retries when delivery is uncertain |
| Approvals | Read-only / require-approval / direct policies per integration; approval binds to the exact payload hash and recipient; edits need renewed approval |
| REST API | `/api/v1`, scoped hashed API keys with expiry/rotation/revocation, idempotency keys, rate limiting, pagination, OpenAPI 3.1 + authenticated Swagger UI at `/api/docs` |
| MCP | Streamable HTTP server at `/mcp` (official TypeScript SDK) with 32 tools, strict schemas, structured output, accurate annotations, OAuth 2.1 (PKCE S256, dynamic client registration, client ID metadata documents, refresh-token rotation with reuse detection, revocation, consent screen, scoped account grants) |
| Webhooks | 12 event types, HMAC-SHA256 signatures, persistent delivery queue with retries, history, redelivery, test button, SSRF protection |
| Administration | Roles (Super Administrator, Administrator, Messaging Agent, Read-only, Integration Client), per-account READ / SEND / MANAGE access, activity log, system health, settings, first-run setup wizard, light/dark themes |

\* limited by the configured maximum and server capacity (each account runs its own Chromium, ~250–400 MB RAM).

## Stack

Node.js 22 · TypeScript · Express 5 · whatsapp-web.js (Puppeteer + system Chromium) · MySQL/MariaDB via Prisma 7 ·
React 19 + Vite + Tailwind CSS 4 + shadcn-style Radix components · Socket.IO · MCP TypeScript SDK · PM2.
No Docker, Redis or paid services.

## Repository layout

```
.
├── server/                    Node.js application (Express, WhatsApp, MCP, OAuth, workers)
│   ├── prisma/                schema.prisma and version-controlled migrations
│   └── src/
│       ├── config/            environment validation
│       ├── db/                Prisma client (MariaDB driver adapter)
│       ├── whatsapp/          session manager, event → database sync, mapping
│       ├── services/          domain logic: permissions, outbound pipeline, approvals, scheduler, webhooks, media, audit…
│       ├── http/              route helper (Zod validation + OpenAPI), middleware, REST routes
│       ├── oauth/             OAuth 2.1 provider for the SDK auth router
│       ├── mcp/               MCP tools and Streamable HTTP endpoint
│       ├── realtime/          Socket.IO channel
│       └── test/              Vitest suites (whatsapp-web.js mocked)
├── web/                       React dashboard (built into web/dist and served by the server)
├── deploy/                    Apache / Nginx / DirectAdmin examples, shared script helpers
├── docs/                      Deployment, MCP, API, backup, security, troubleshooting, manual test checklist
├── install.sh update.sh backup.sh restore.sh
├── ecosystem.config.cjs       PM2 (single fork-mode instance)
└── .env.example
```

## Quick start (production, Debian)

```bash
sudo git clone <repository> /opt/techtix-whatsapp
cd /opt/techtix-whatsapp
sudo ./install.sh            # interactive; never edits Apache/Nginx/DirectAdmin/firewall/MySQL config
```

Then configure the reverse proxy and HTTPS ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)), open
`https://whatsapp.techtixglobal.com/setup`, enter the installation token and complete the wizard.

## Local development

```bash
cp .env.example .env               # set DATABASE_URL, APP_ENCRYPTION_KEY, BASE_URL=http://localhost:3100,
                                   # HOST=127.0.0.1, DATA_DIR=./.data, CHROMIUM_PATH (e.g. Google Chrome)
npm ci
npm run db:migrate -w server       # prisma migrate dev
npm run dev -w server              # API on :3100
npm run dev -w web                 # dashboard on :5173 (proxies to :3100)
```

## Environment

See [.env.example](.env.example). Required: `DATABASE_URL`, `APP_ENCRYPTION_KEY` (32 bytes), `BASE_URL`.
Important: `DATA_DIR` (sessions, media), `CHROMIUM_PATH`, `HOST`/`PORT`, `TRUST_PROXY`, `SETUP_TOKEN`.
General settings (timezone, retention, limits, approval policy…) are edited in **Settings** and stored in the database.

## Database

```bash
cd server
npx prisma migrate deploy          # apply migrations (production)
npx prisma migrate status
```

The database must use `utf8mb4`. All timestamps are stored in UTC and shown in each user's timezone.

## Tests

```bash
# needs a disposable MySQL/MariaDB database; defaults to techtix_whatsapp_test on localhost
TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/techtix_whatsapp_test npm test
```

The suites mock whatsapp-web.js. Live WhatsApp behaviour must be verified with [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md).

## Documentation

- [Deployment, DirectAdmin, HTTPS, Chromium](docs/DEPLOYMENT.md)
- [Connecting ChatGPT / MCP clients](docs/MCP.md)
- [REST API](docs/API.md) — full reference at `/api/docs`
- [Backup and restore](docs/BACKUP.md)
- [Security model](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Manual integration test checklist](docs/MANUAL_TESTING.md)
- [Known limitations](docs/LIMITATIONS.md)

## Browser support

The dashboard targets evergreen browsers released since mid-2024 (it uses CSS `light-dark()` and `:has()`).
