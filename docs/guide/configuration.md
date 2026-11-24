# Configuration

Chinwag has two kinds of configuration:

- **Deployment settings** in `/opt/chinwag/.env` — secrets and infrastructure. Restart after editing: `chinwag restart`.
- **Application settings** in the dashboard under **Settings** — stored in the database and applied immediately.

## Environment (`.env`)

| Variable | Default | Description |
|---|---|---|
| `BASE_URL` | — | Public URL, e.g. `https://chat.example.com`. Used for OAuth, MCP and links; must be HTTPS in production. |
| `HOST` / `PORT` | `127.0.0.1` / `3100` | Listen address. Keep it on localhost behind a proxy. |
| `TRUST_PROXY` | `1` | Number of proxies in front (for client IPs and HTTPS detection). |
| `DATABASE_URL` | — | `mysql://user:pass@host:port/db`. MySQL 8 or MariaDB 10.6+, utf8mb4. |
| `DATA_DIR` | `/var/lib/chinwag` | WhatsApp sessions, media and runtime files. |
| `APP_ENCRYPTION_KEY` | generated | 32 bytes (base64 or hex). Encrypts stored webhook and OAuth secrets. **Back it up separately**; losing it makes those secrets unrecoverable. |
| `SETUP_TOKEN` | generated | One-time token for `/setup`. Can be cleared after setup. |
| `CHROMIUM_PATH` | detected | Browser executable (`/usr/bin/google-chrome-stable` or `/usr/bin/chromium`). |
| `CHROMIUM_DISABLE_SANDBOX` | `false` | Only if the kernel cannot run the browser sandbox. Reduces isolation. |
| `CHROMIUM_START_CONCURRENCY` | `2` | Maximum browsers starting at the same time. |
| `WEBHOOK_ALLOWED_PRIVATE_CIDRS` | empty | Allow webhooks to private networks, e.g. `10.0.5.0/24`. Empty blocks all private/reserved ranges. |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug`. |

## Application settings

| Group | Settings |
|---|---|
| General | Application name, logo URL, base URL, default timezone and language |
| Sessions & sign-in | Session lifetime, idle timeout, failed sign-ins before lockout, lockout duration, minimum password length |
| WhatsApp | Maximum connected accounts, initial sync (chats and messages per chat), automatic media download, automatic reconnect attempts |
| Messaging & storage | Maximum attachment size, scheduled message expiry, message / media / activity-log retention |
| Integrations | Default approval policy for new MCP connections, API rate limit, dynamic OAuth client registration |
