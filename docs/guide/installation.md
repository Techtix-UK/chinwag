# Installation

## One-line install

On a fresh Debian 12+ / Ubuntu 22.04+ server, as root (or with `sudo`):

```bash
curl -fsSL https://raw.githubusercontent.com/Techtix-UK/chinwag/main/install.sh | sudo bash
```

The installer asks three questions — your hostname, how HTTPS should be provided, and an email for certificate notices — then:

1. checks the OS, architecture, memory and disk;
2. installs Node.js 22, PM2, a browser (Chrome on Ubuntu, Chromium on Debian) and fonts;
3. creates the `chinwag` system user and private data directory (`/var/lib/chinwag`, mode 700);
4. clones the latest release into `/opt/chinwag`;
5. creates the database (local MariaDB, a Docker MariaDB if another database server is already running, or your existing database);
6. writes `.env` with a generated encryption key and one-time setup token;
7. builds Chinwag, applies database migrations and starts it under PM2 (enabled at boot);
8. configures HTTPS with **Caddy** (automatic certificates), **Nginx + Let's Encrypt**, or prints **Cloudflare Tunnel** instructions;
9. installs the [`chinwag` command](/operations/cli);
10. prints your setup link and token.

A full log is written to `/var/log/chinwag-install.log`.

::: tip Prefer to read before running?
```bash
curl -fsSLo install.sh https://raw.githubusercontent.com/Techtix-UK/chinwag/main/install.sh
less install.sh
sudo bash install.sh
```
:::

## Unattended install

Every question has a flag (or `CHINWAG_*` environment variable):

```bash
curl -fsSL https://raw.githubusercontent.com/Techtix-UK/chinwag/main/install.sh | sudo bash -s -- \
  --domain chat.example.com --email ops@example.com --proxy caddy --yes
```

| Flag | Default | Meaning |
|---|---|---|
| `--domain` | — | Public hostname. Empty = local only (`http://127.0.0.1:3100`). |
| `--email` | — | Let's Encrypt contact email (Caddy / Nginx). |
| `--proxy` | `caddy` | `caddy`, `nginx`, `cloudflare` or `none`. If ports 80/443 are already in use, no web server is installed. |
| `--db` | `auto` | `local` (MariaDB on this host), `docker` (MariaDB container on `127.0.0.1:3307`), `external`, or `auto`. |
| `--database-url` | — | Use an existing database: `mysql://user:pass@host:3306/db` (utf8mb4). |
| `--dir` | `/opt/chinwag` | Install directory. |
| `--data-dir` | `/var/lib/chinwag` | Sessions, media and runtime data. |
| `--port` | `3100` | Local port (always bound to `127.0.0.1`). |
| `--ref` | latest release | Git tag or branch to install. |
| `-y`, `--yes` | — | Non-interactive; accept defaults. |

Re-running the installer on an existing installation is safe: it keeps `.env` and data, and repairs or updates the rest.

## DNS first

Point an `A` (and `AAAA`, if you have IPv6) record for your hostname at the server **before** installing with Caddy or Nginx so the certificate can be issued straight away. With Caddy, the certificate is requested on the first HTTPS request; with Nginx the installer runs certbot and tells you if it failed.

## What gets installed where

| Path | Contents |
|---|---|
| `/opt/chinwag` | Application (git checkout), `.env` (mode 640, root:chinwag) |
| `/var/lib/chinwag` | WhatsApp sessions, media, setup token (mode 700) |
| `/var/log/chinwag` | Application logs |
| `/var/backups/chinwag` | Encrypted backups |
| `/etc/chinwag/chinwag.conf` | Paths used by the `chinwag` command |
| `/root/.chinwag-backup-passphrase` | Backup encryption passphrase — **store it off the server** |
| `/root/chinwag-database.txt` | Database URL created by the installer (root only) |

## Manual installation

If you need full control (custom database, existing proxy, configuration management), see the step-by-step equivalent:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin chinwag
sudo install -d -m 700 -o chinwag -g chinwag /var/lib/chinwag
sudo install -d -m 750 -o chinwag -g chinwag /var/log/chinwag
sudo git clone https://github.com/Techtix-UK/chinwag.git /opt/chinwag
cd /opt/chinwag && sudo cp .env.example .env      # edit: BASE_URL, DATABASE_URL, APP_ENCRYPTION_KEY, CHROMIUM_PATH
sudo chown -R chinwag:chinwag /opt/chinwag && sudo chown root:chinwag .env && sudo chmod 640 .env
sudo -u chinwag -H env PUPPETEER_SKIP_DOWNLOAD=1 npm ci -w server -w web --include-workspace-root
sudo -u chinwag -H npm run build
(cd server && sudo -u chinwag -H npx prisma migrate deploy)
sudo npm install -g pm2
sudo -u chinwag -H pm2 start ecosystem.config.cjs && sudo -u chinwag -H pm2 save
sudo pm2 startup systemd -u chinwag --hp /home/chinwag
sudo ln -s /opt/chinwag/scripts/chinwag /usr/local/bin/chinwag
```

Then configure [HTTPS](/guide/reverse-proxy) and continue with [first-run setup](/guide/first-run).

::: danger One process only
Never run more than one Chinwag process or use PM2 cluster mode. The process owns the WhatsApp sessions; a second copy would open competing sessions for the same accounts.
:::
