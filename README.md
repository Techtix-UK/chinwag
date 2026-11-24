<p align="center">
  <img src="branding/chinwag-mark.svg" width="96" height="96" alt="Chinwag">
</p>

<h1 align="center">Chinwag</h1>

<p align="center">
  <strong>Your WhatsApp, on your server, ready for AI.</strong><br>
  A self-hosted team inbox, REST API and MCP server for WhatsApp — connect ChatGPT and your own apps to all of your WhatsApp numbers, with approvals, audit logs and per-account permissions.
</p>

<p align="center">
  <a href="https://techtix-uk.github.io/chinwag/"><b>Documentation</b></a> ·
  <a href="https://techtix-uk.github.io/chinwag/guide/installation">Install</a> ·
  <a href="https://techtix-uk.github.io/chinwag/integrations/chatgpt">ChatGPT setup</a> ·
  <a href="https://github.com/Techtix-UK/chinwag/releases">Releases</a>
</p>

<p align="center">
  <a href="https://github.com/Techtix-UK/chinwag/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Techtix-UK/chinwag/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Licence: AGPL-3.0" src="https://img.shields.io/badge/licence-AGPL--3.0-EF3C00"></a>
  <img alt="Node 22" src="https://img.shields.io/badge/node-22-07182C">
  <img alt="Debian / Ubuntu" src="https://img.shields.io/badge/runs%20on-Debian%20%7C%20Ubuntu-07182C">
</p>

<p align="center">
  <img src="docs/public/screenshots/inbox.png" alt="Chinwag inbox" width="900">
</p>

## Why Chinwag?

- 📱 **Many numbers, one inbox.** Link personal and Business WhatsApp accounts by QR code. Each runs in its own isolated session that survives restarts.
- 🤖 **ChatGPT & MCP built in.** A standards-based remote MCP server with OAuth 2.1 — ask ChatGPT to find conversations, summarise customers or draft replies.
- ✅ **You stay in control.** Confirm every message in ChatGPT, approve it in the dashboard, or allow direct sending — per connection. Recipients and accounts are never guessed.
- 🔌 **REST API & webhooks.** Scoped API keys, idempotent sends, OpenAPI docs, HMAC-signed webhooks.
- 🗓️ **Scheduling that survives restarts**, with timezones and no risky automatic retries.
- 🔐 **Secure by default.** Argon2id, CSRF protection, roles with per-account access, audit logs, encrypted backups, SSRF guards, sandboxed browser.
- 🏠 **Your data stays yours.** Runs on your server with MariaDB/MySQL. No Docker, Redis or paid services required.

## Install

On a fresh **Debian 12+ / Ubuntu 22.04+** server with a domain pointing at it:

```bash
curl -fsSL https://raw.githubusercontent.com/Techtix-UK/chinwag/main/install.sh | sudo bash
```

The installer sets up Node.js, a browser, MariaDB, HTTPS (Caddy or Nginx + Let's Encrypt, or a Cloudflare Tunnel), PM2 and the `chinwag` management command, then prints your setup link. Unattended:

```bash
curl -fsSL https://raw.githubusercontent.com/Techtix-UK/chinwag/main/install.sh | sudo bash -s -- \
  --domain chat.example.com --email ops@example.com --proxy caddy --yes
```

→ [Installation guide](https://techtix-uk.github.io/chinwag/guide/installation) · [Requirements](https://techtix-uk.github.io/chinwag/guide/requirements) · [Reverse proxy](https://techtix-uk.github.io/chinwag/guide/reverse-proxy)

## Connect ChatGPT

1. ChatGPT → **Settings → Apps & Connectors → Create** (developer mode).
2. MCP server URL `https://chat.example.com/mcp`, authentication **OAuth**.
3. Sign in to Chinwag, choose the accounts, permissions and how messages are confirmed.
4. *"Show my unread WhatsApp messages on the UK account."*

→ [ChatGPT guide](https://techtix-uk.github.io/chinwag/integrations/chatgpt) · [MCP tools](https://techtix-uk.github.io/chinwag/integrations/mcp-tools)

## Manage

```bash
sudo chinwag status          # health and process status
sudo chinwag logs -f         # follow logs
sudo chinwag update          # back up, update, migrate, restart
sudo chinwag backup --stop   # encrypted backup of database, sessions, media and .env
sudo chinwag doctor          # end-to-end checks
```

<table>
  <tr>
    <td><img src="docs/public/screenshots/overview.png" alt="Overview"></td>
    <td><img src="docs/public/screenshots/approvals.png" alt="Message approvals"></td>
  </tr>
  <tr>
    <td><img src="docs/public/screenshots/inbox-dark.png" alt="Inbox, dark mode"></td>
    <td><img src="docs/public/screenshots/accounts-dark.png" alt="WhatsApp accounts, dark mode"></td>
  </tr>
</table>

## Development

```bash
git clone https://github.com/Techtix-UK/chinwag.git && cd chinwag
cp .env.example .env        # BASE_URL=http://localhost:3100, DATABASE_URL, APP_ENCRYPTION_KEY, CHROMIUM_PATH, DATA_DIR=./.data
npm ci
npm run db:migrate          # prisma migrate dev
npm run dev -w server       # API on :3100
npm run dev -w web          # dashboard on :5173
npm run docs:dev            # documentation site
TEST_DATABASE_URL=mysql://chinwag:chinwag@127.0.0.1:3306/chinwag_test npm test
```

Tests mock whatsapp-web.js; live behaviour is covered by the [manual test checklist](https://techtix-uk.github.io/chinwag/operations/manual-testing). See [CONTRIBUTING.md](CONTRIBUTING.md) and the [architecture overview](https://techtix-uk.github.io/chinwag/reference/architecture).

## Important

Chinwag drives WhatsApp Web through the open-source [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) library. **It is not affiliated with, endorsed by, or an official product of WhatsApp or Meta.** WhatsApp Web changes can break it until the library catches up, and WhatsApp may restrict accounts it considers automated. Use it for conversations people expect — never for bulk or unsolicited messaging.

## Licence

[AGPL-3.0](LICENSE) © [Techtix Global](https://techtixglobal.com). You may self-host and modify Chinwag freely; if you offer a modified version as a network service, you must make your source available. Security issues: see [SECURITY.md](SECURITY.md).
