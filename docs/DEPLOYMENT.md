# Deployment (Debian + DirectAdmin)

Techtix WhatsApp runs as an independent Node.js service on `127.0.0.1:3100`, managed by PM2 under a
dedicated non-root user, behind the existing Apache or Nginx. It does not interfere with other sites.

| Item | Default |
|---|---|
| Application | `/opt/techtix-whatsapp` |
| Persistent data (sessions, media) | `/var/lib/techtix-whatsapp` (mode 700) |
| Logs | `/var/log/techtix-whatsapp` |
| Backups | `/var/backups/techtix-whatsapp` |
| Service user | `techtix-whatsapp` (no login shell) |
| Internal port | `3100` on `127.0.0.1` |
| Public URL | `https://whatsapp.techtixglobal.com` |

## 1. Requirements

- Debian 12 or 13, 2 vCPU and 2 GB RAM minimum (+~300 MB per connected WhatsApp account).
- Node.js 22 LTS (20.19+ works).
- MySQL 8 / MariaDB 10.6+ (DirectAdmin's server is fine).
- Chromium and fonts.

### Chromium dependencies

```bash
sudo apt-get update
sudo apt-get install -y chromium fonts-liberation fonts-noto-color-emoji ca-certificates
chromium --version
```

Set `CHROMIUM_PATH=/usr/bin/chromium` in `.env` (the installer does this). Puppeteer's own browser download
is skipped (`PUPPETEER_SKIP_DOWNLOAD=1`).

**Sandbox.** The Chromium sandbox is kept enabled. It needs unprivileged user namespaces:

```bash
sysctl kernel.unprivileged_userns_clone          # must be 1 on Debian kernels that have the switch
# if 0 (decide deliberately — this is a host-wide setting):
echo 'kernel.unprivileged_userns_clone=1' | sudo tee /etc/sysctl.d/99-chromium-sandbox.conf && sudo sysctl --system
```

Only if that is impossible, set `CHROMIUM_DISABLE_SANDBOX=true` (reduced isolation; shown as a warning in setup).

## 2. Database

Create a database and user (DirectAdmin → **MySQL Management**, or SQL):

```sql
CREATE DATABASE techtix_whatsapp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'techtix_whatsapp'@'localhost' IDENTIFIED BY '<strong random password>';
GRANT ALL PRIVILEGES ON techtix_whatsapp.* TO 'techtix_whatsapp'@'localhost';
```

DirectAdmin prefixes names with the account user (e.g. `admin_techtixwa`); use the full names in `DATABASE_URL`.
URL-encode special characters in the password.

## 3. Install

```bash
sudo git clone <repository> /opt/techtix-whatsapp
cd /opt/techtix-whatsapp
sudo ./install.sh
```

The installer asks before each system change: Node.js (NodeSource), Chromium packages, creating the
service user, installing PM2 and enabling PM2 at boot. It creates `.env` (generating `APP_ENCRYPTION_KEY`
and a one-time `SETUP_TOKEN`), runs `npm ci`, builds, applies migrations (`prisma migrate deploy`) and
starts the single PM2 instance.

Manual equivalent:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin techtix-whatsapp
sudo install -d -m 700 -o techtix-whatsapp -g techtix-whatsapp /var/lib/techtix-whatsapp
sudo install -d -m 750 -o techtix-whatsapp -g techtix-whatsapp /var/log/techtix-whatsapp
cp .env.example .env && editor .env          # then: chown root:techtix-whatsapp .env && chmod 640 .env
sudo -u techtix-whatsapp PUPPETEER_SKIP_DOWNLOAD=1 npm ci
sudo -u techtix-whatsapp npm run build
cd server && sudo -u techtix-whatsapp npx prisma migrate deploy && cd ..
sudo npm install -g pm2
sudo -u techtix-whatsapp pm2 start ecosystem.config.cjs && sudo -u techtix-whatsapp pm2 save
sudo pm2 startup systemd -u techtix-whatsapp --hp /home/techtix-whatsapp
```

> **Never** run more than one instance or use PM2 cluster mode: the process owns the WhatsApp sessions,
> and duplicates would start competing Chromium sessions for the same accounts.

## 4. Reverse proxy and HTTPS

Requirements for the proxy: WebSockets on `/socket.io/`, unbuffered streaming on `/mcp`, request bodies of
at least 150 MB (attachments), and `X-Forwarded-Proto: https`. Keep `TRUST_PROXY=1` (one proxy hop).

### DirectAdmin (Apache)

1. **Account Manager → Domain Setup** (or Subdomain Management) — create `whatsapp.techtixglobal.com`.
2. **SSL Certificates** — issue a free Let's Encrypt certificate for it and enable "Force SSL".
3. **Admin Level → Custom HTTPD Configurations → whatsapp.techtixglobal.com → httpd.conf** — paste
   [`deploy/apache/directadmin-custom-httpd.conf`](../deploy/apache/directadmin-custom-httpd.conf) and save.
   DirectAdmin rewrites the vhost for that domain only.
4. Ensure `mod_proxy`, `mod_proxy_http`, `mod_proxy_wstunnel`, `mod_headers` are loaded (they are on
   standard DirectAdmin CustomBuild Apache builds). Do not change global Apache configuration.

### DirectAdmin (Nginx or Nginx + Apache)

Use [`deploy/nginx/directadmin-nginx-custom.conf`](../deploy/nginx/directadmin-nginx-custom.conf) in the
domain's **nginx.conf** custom token.

### Plain Apache / Nginx

Examples: [`deploy/apache/techtix-whatsapp.conf`](../deploy/apache/techtix-whatsapp.conf),
[`deploy/nginx/techtix-whatsapp.conf`](../deploy/nginx/techtix-whatsapp.conf). Obtain certificates with certbot:

```bash
sudo certbot certonly --webroot -w /var/www/letsencrypt -d whatsapp.techtixglobal.com
```

### HTTPS enforcement in the app

When `BASE_URL` is `https://…` the application marks cookies `Secure`, sends HSTS, redirects plain-HTTP
requests that reach it (based on `X-Forwarded-Proto`) and refuses non-HTTPS webhook destinations.

## 5. Setup wizard

Open `https://whatsapp.techtixglobal.com/setup`, enter the token (`SETUP_TOKEN` in `.env`, or
`/var/lib/techtix-whatsapp/setup-token` if it was generated at start-up). The wizard validates the
environment, database, migrations and Chromium, creates the first Super Administrator (no default
passwords exist), sets the URL, timezone and security defaults, then disables itself permanently.
You can remove `SETUP_TOKEN` from `.env` afterwards.

## 6. Operations

```bash
sudo -u techtix-whatsapp pm2 status
sudo -u techtix-whatsapp pm2 logs techtix-whatsapp
curl -s http://127.0.0.1:3100/api/v1/health
sudo ./update.sh            # backup DB → pull → npm ci → build → migrate → restart
sudo ./backup.sh --stop     # encrypted full backup (see BACKUP.md)
```

Sessions reconnect automatically after restarts unless an administrator disconnected or logged them out.

## 7. Firewall

Only 80/443 need to be public. Port 3100 is bound to localhost; no firewall change is required.
