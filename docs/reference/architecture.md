# Architecture

| Layer | Technology |
|---|---|
| Server | Node.js 22, TypeScript, Express 5 |
| WhatsApp | whatsapp-web.js + Puppeteer driving headless Chrome/Chromium (one isolated `LocalAuth` profile per account) |
| Database | MySQL 8 / MariaDB 10.6+ via Prisma 7 (versioned migrations) |
| Dashboard | React 19, Vite, Tailwind CSS 4, Radix/shadcn-style components, TanStack Query |
| Real-time | Socket.IO (session-authenticated, per-account rooms) |
| MCP | Official MCP TypeScript SDK — Streamable HTTP, stateless; SDK OAuth router with a database-backed provider |
| Process | PM2, single fork-mode instance |

## Repository layout

```
server/            API, WhatsApp session manager, MCP + OAuth, workers
  prisma/          schema and migrations
  src/whatsapp/    session manager (lifecycle, recovery, watchdog) and event → database sync
  src/services/    permissions, outbound pipeline, approvals, scheduler, webhooks, media, audit, health
  src/http/        Zod-validated routes (also generate the OpenAPI document)
  src/mcp/         MCP tools and HTTP transport
  src/oauth/       OAuth 2.1 provider (DCR, client metadata documents, rotation)
web/               React dashboard (built into web/dist, served by the server)
docs/              this documentation site (VitePress)
scripts/           chinwag CLI, update, backup, restore, doctor
deploy/            Nginx, Apache and DirectAdmin examples
install.sh         one-line installer
```

## Request flow for an outbound message

```
REST / MCP / dashboard ──► permission check (role + per-account level)
                        ──► recipient resolution (no guessing; candidates on ambiguity)
                        ──► policy: read-only · confirm in chat · dashboard approval · direct
                        ──► idempotency key check
                        ──► WhatsApp session (must be ready) ──► stored message + webhook + live update
```

## Design rules

- **One process owns all sessions.** Chromium start-ups are rate-limited; one account's failure never affects another.
- **Bounded recovery.** Exponential back-off with a retry limit; intentionally disconnected accounts are never reconnected automatically.
- **Never report a message as sent unless WhatsApp accepted it**, and never retry when delivery is uncertain.
- **Server-side authorisation everywhere** — REST, MCP and Socket.IO rooms.
