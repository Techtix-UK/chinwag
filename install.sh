#!/usr/bin/env bash
# Techtix WhatsApp — installer for Debian (12/13) including DirectAdmin servers.
#
# Usage (as root, from the cloned repository at /opt/techtix-whatsapp):
#   sudo ./install.sh
#
# The installer NEVER changes Apache/Nginx/DirectAdmin, firewall or database server configuration.
# Every system-level change (packages, users, PM2 start-up) is confirmed interactively.
set -Eeuo pipefail
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
source deploy/common.sh

require_root
c_info "Techtix WhatsApp installer — application directory: $APP_DIR"
grep -qi debian /etc/os-release || c_warn "This does not look like Debian; continuing at your own risk."

# ── 1. Node.js ──────────────────────────────────────────────────────────────
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22)||(a===20&&b>=19)?0:1)'; then
  c_warn "Node.js 20.19+ (22 LTS recommended) is required."
  if confirm "Install Node.js 22 LTS from NodeSource (adds an apt repository)?"; then
    apt-get update && apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    die "Install Node.js 22 LTS and re-run."
  fi
fi
c_info "Node.js $(node -v)"

# ── 2. Chromium and runtime libraries ───────────────────────────────────────
if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
  if confirm "Install Debian's Chromium and fonts (apt: chromium fonts-liberation fonts-noto-color-emoji)?"; then
    apt-get update && apt-get install -y chromium fonts-liberation fonts-noto-color-emoji ca-certificates
  else
    c_warn "Chromium not installed — WhatsApp accounts cannot connect until it is (see docs/DEPLOYMENT.md)."
  fi
fi
CHROMIUM_BIN="$(command -v chromium || command -v chromium-browser || echo /usr/bin/chromium)"

# Chromium's sandbox needs unprivileged user namespaces.
if [[ -f /proc/sys/kernel/unprivileged_userns_clone ]] && [[ "$(cat /proc/sys/kernel/unprivileged_userns_clone)" != "1" ]]; then
  c_warn "kernel.unprivileged_userns_clone=0 — the Chromium sandbox cannot start."
  c_warn "Recommended: echo 'kernel.unprivileged_userns_clone=1' > /etc/sysctl.d/99-chromium-sandbox.conf && sysctl --system"
  c_warn "(Not changed automatically.) Alternatively set CHROMIUM_DISABLE_SANDBOX=true, which reduces isolation."
fi

# ── 3. Service user and directories ─────────────────────────────────────────
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  if confirm "Create dedicated non-root system user '$SERVICE_USER'?"; then
    useradd --system --create-home --home-dir "/home/$SERVICE_USER" --shell /usr/sbin/nologin "$SERVICE_USER"
  else
    die "A dedicated non-root service user is required."
  fi
fi
DATA_DIR="$(env_get DATA_DIR || true)"; DATA_DIR="${DATA_DIR:-$DATA_DIR_DEFAULT}"
install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR" "$DATA_DIR/sessions" "$DATA_DIR/media" "$DATA_DIR/tmp"
install -d -m 750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$LOG_DIR"
install -d -m 700 -o root -g root "$BACKUP_DIR"

# ── 4. Environment file ─────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  c_info "Creating .env"
  cp .env.example .env
  read -r -p "Public URL [https://whatsapp.techtixglobal.com]: " BASE_URL </dev/tty || true
  BASE_URL="${BASE_URL:-https://whatsapp.techtixglobal.com}"
  read -r -p "Local port [3100]: " PORT </dev/tty || true
  PORT="${PORT:-3100}"
  echo "Database: create it yourself (or in DirectAdmin → MySQL Management) with utf8mb4. Example SQL:"
  echo "  CREATE DATABASE techtix_whatsapp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  echo "  CREATE USER 'techtix_whatsapp'@'localhost' IDENTIFIED BY '<strong password>';"
  echo "  GRANT ALL PRIVILEGES ON techtix_whatsapp.* TO 'techtix_whatsapp'@'localhost';"
  read -r -p "DATABASE_URL (mysql://user:pass@127.0.0.1:3306/dbname): " DATABASE_URL </dev/tty
  [[ -n "$DATABASE_URL" ]] || die "DATABASE_URL is required"
  KEY="$(openssl rand -base64 32)"
  TOKEN="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)"
  node -e '
    const fs = require("fs"); let s = fs.readFileSync(".env", "utf8");
    const set = (k, v) => { s = s.replace(new RegExp("^" + k + "=.*$", "m"), k + "=" + v); };
    const [,, base, port, db, key, token, chrome, data] = process.argv;
    set("BASE_URL", base); set("PORT", port); set("DATABASE_URL", db); set("APP_ENCRYPTION_KEY", key);
    set("SETUP_TOKEN", token); set("CHROMIUM_PATH", chrome); set("DATA_DIR", data);
    fs.writeFileSync(".env", s);
  ' "$BASE_URL" "$PORT" "$DATABASE_URL" "$KEY" "$TOKEN" "$CHROMIUM_BIN" "$DATA_DIR"
  c_warn "APP_ENCRYPTION_KEY was generated. Store a copy somewhere safe and separate from backups."
fi
chown root:"$SERVICE_USER" .env && chmod 640 .env

# ── 5. Dependencies, build and migrations ───────────────────────────────────
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"
chown root:"$SERVICE_USER" .env
c_info "Installing dependencies (npm ci)…"
as_service npm ci --no-audit --no-fund
c_info "Building…"
as_service npm run build
c_info "Applying database migrations…"
(cd server && as_service npx prisma migrate deploy)

# ── 6. PM2 ──────────────────────────────────────────────────────────────────
if ! command -v pm2 >/dev/null; then
  if confirm "Install PM2 globally (npm install -g pm2)?"; then npm install -g pm2; else die "PM2 is required."; fi
fi
pm2_service start ecosystem.config.cjs
pm2_service save
if confirm "Enable PM2 start-up at boot for user '$SERVICE_USER' (creates a systemd unit)?"; then
  pm2 startup systemd -u "$SERVICE_USER" --hp "/home/$SERVICE_USER"
fi

PORT="$(env_get PORT)"; BASE_URL="$(env_get BASE_URL)"; TOKEN="$(env_get SETUP_TOKEN)"
cat <<MSG

Techtix WhatsApp is running on http://127.0.0.1:${PORT:-3100} (bound to localhost).

Next steps:
  1. Configure the reverse proxy and HTTPS (deploy/apache/*.conf or deploy/nginx/*.conf; DirectAdmin guide in docs/DEPLOYMENT.md).
  2. Open ${BASE_URL}/setup and complete the setup wizard.
     One-time installation token: ${TOKEN:-see $DATA_DIR/setup-token}
  3. Schedule encrypted backups: ./backup.sh (see docs/BACKUP.md).
MSG
