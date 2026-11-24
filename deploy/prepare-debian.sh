#!/usr/bin/env bash
# Techtix WhatsApp — server preparation for plain Debian 12/13 or Ubuntu 24.04+ (no DirectAdmin).
# Covers everything before "git clone": base packages, Node.js 22, Chromium, sandbox check,
# time sync, MariaDB server, and the application database + user.
#
# Usage (as root):
#   bash prepare-debian.sh
# Optional overrides:
#   DB_NAME=techtix_whatsapp DB_USER=techtix_whatsapp DB_PASS='...' SKIP_MARIADB=1 bash prepare-debian.sh
set -Eeuo pipefail

DB_NAME="${DB_NAME:-techtix_whatsapp}"
DB_USER="${DB_USER:-techtix_whatsapp}"
DB_PASS="${DB_PASS:-}"
SKIP_MARIADB="${SKIP_MARIADB:-0}"
CRED_FILE="/root/techtix-whatsapp-database.txt"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo bash $0)."
. /etc/os-release
[[ "${ID:-}" == "debian" || "${ID:-}" == "ubuntu" ]] || warn "This script targets Debian/Ubuntu; detected '${PRETTY_NAME:-unknown}'. Continuing."
[[ -d /usr/local/directadmin ]] && die "DirectAdmin detected — use DirectAdmin's MySQL and web server instead of this script."
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]{1,64}$ ]] || die "DB_NAME may only contain letters, digits and underscores."
[[ "$DB_USER" =~ ^[A-Za-z0-9_]{1,32}$ ]] || die "DB_USER may only contain letters, digits and underscores."

export DEBIAN_FRONTEND=noninteractive

# ── 1. Base packages ────────────────────────────────────────────────────────
info "Installing base packages"
apt-get update -q
apt-get install -y -q git curl ca-certificates openssl sudo gnupg

# ── 2. Time synchronisation (OAuth tokens and webhook signatures are time-based) ──
if ! timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes; then
  info "Enabling time synchronisation"
  apt-get install -y -q systemd-timesyncd || true
  timedatectl set-ntp true || warn "Could not enable NTP — make sure the clock is accurate."
fi

# ── 3. Node.js 22 LTS (NodeSource apt repository) ───────────────────────────
node_ok() {
  command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>=22||(a===20&&b>=19)?0:1)'
}
if node_ok; then
  info "Node.js $(node -v) already installed"
else
  info "Installing Node.js 22 LTS from NodeSource"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
  node_ok || die "Node.js installation failed."
fi

# ── 4. Browser and fonts ────────────────────────────────────────────────────
# Debian: distribution Chromium (.deb). Ubuntu: its "chromium" is a snap, which cannot be driven by a
# background service user, so Google Chrome stable is installed from Google's signed apt repository instead.
apt-get install -y -q fonts-liberation fonts-noto-color-emoji
if [[ "${ID:-}" == "ubuntu" ]]; then
  [[ "$(dpkg --print-architecture)" == "amd64" ]] || die "Google Chrome .deb is amd64-only; on ARM use Debian (chromium .deb) instead."
  if ! command -v google-chrome-stable >/dev/null; then
    info "Installing Google Chrome stable (Ubuntu's chromium is a snap and is not usable)"
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /etc/apt/keyrings/google-chrome.gpg
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" >/etc/apt/sources.list.d/google-chrome.list
    apt-get update -q
    apt-get install -y -q google-chrome-stable
  fi
  CHROMIUM_BIN="$(command -v google-chrome-stable || true)"
  if dpkg -s chromium-browser >/dev/null 2>&1 || snap list chromium >/dev/null 2>&1; then
    warn "The snap Chromium is installed but will not be used. Remove it if nothing else needs it: apt-get remove chromium-browser && snap remove chromium"
  fi
else
  info "Installing Chromium"
  apt-get install -y -q chromium
  CHROMIUM_BIN="$(command -v chromium || true)"
fi
[[ -n "$CHROMIUM_BIN" ]] || die "Browser not found after installation."
if [[ "$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" == "1" ]]; then
  info "AppArmor restricts unprivileged user namespaces; Chrome uses its setuid sandbox helper instead (sandbox stays enabled)."
fi

# Chromium's sandbox needs unprivileged user namespaces.
USERNS_FILE=/proc/sys/kernel/unprivileged_userns_clone
if [[ -f $USERNS_FILE && "$(cat $USERNS_FILE)" != "1" ]]; then
  info "Enabling unprivileged user namespaces for the Chromium sandbox"
  echo 'kernel.unprivileged_userns_clone=1' >/etc/sysctl.d/99-chromium-sandbox.conf
  sysctl --system >/dev/null
fi
# Self-test as an unprivileged user with the sandbox enabled (Chromium refuses to run sandboxed as root).
PROBE_DIR="$(mktemp -d)"; chmod 777 "$PROBE_DIR"
if runuser -u nobody -- env HOME="$PROBE_DIR" "$CHROMIUM_BIN" --headless=new --disable-gpu --user-data-dir="$PROBE_DIR/profile" --dump-dom about:blank >/dev/null 2>"$PROBE_DIR/err"; then
  info "Chromium headless self-test passed (sandbox enabled)"
else
  warn "Chromium headless self-test failed:"
  tail -n 5 "$PROBE_DIR/err" >&2 || true
  warn "If the error mentions the sandbox, see docs/DEPLOYMENT.md §1 (or set CHROMIUM_DISABLE_SANDBOX=true later)."
fi
rm -rf "$PROBE_DIR"

# ── 5. MariaDB server + application database ────────────────────────────────
DATABASE_URL=""
if [[ "$SKIP_MARIADB" == "1" ]]; then
  warn "SKIP_MARIADB=1 — create the database yourself (utf8mb4) before running install.sh."
else
  # dpkg -s also succeeds for half-installed/removed packages, so check the exact status.
  if [[ "$(dpkg-query -W -f='${Status}' mariadb-server 2>/dev/null)" != "install ok installed" ]]; then
    # A database server that apt does not manage (e.g. inside Docker) makes mariadb-server's installer fail.
    if pgrep -x mysqld >/dev/null || pgrep -x mariadbd >/dev/null || ss -ltnH 'sport = :3306' 2>/dev/null | grep -q .; then
      warn "A MySQL/MariaDB server is already running on this machine (often inside a Docker container):"
      pgrep -af 'mysqld|mariadbd' >&2 || true
      command -v docker >/dev/null && docker ps --format '  {{.Names}}  {{.Image}}  {{.Ports}}' 2>/dev/null | grep -iE 'mysql|maria' >&2 || true
      warn "Not installing a second server. Use that server or a dedicated container, then run install.sh with its DATABASE_URL."
      apt-get install -y -q mariadb-client || true   # client tools for backup.sh/restore.sh
      SKIP_MARIADB=1
    else
      info "Installing MariaDB server"
      apt-get install -y -q mariadb-server
    fi
  fi
fi
if [[ "$SKIP_MARIADB" != "1" ]]; then
  systemctl enable --now mariadb
  SQL=mariadb; command -v mariadb >/dev/null || SQL=mysql

  USER_EXISTS="$($SQL -N -B -e "SELECT COUNT(*) FROM mysql.user WHERE User='${DB_USER}' AND Host='localhost';")"
  if [[ "$USER_EXISTS" != "0" && -z "$DB_PASS" ]]; then
    warn "Database user '${DB_USER}'@'localhost' already exists — leaving its password unchanged."
    warn "Re-run with DB_PASS='<password>' to reset it, or use the existing credentials in $CRED_FILE."
  else
    if [[ -z "$DB_PASS" ]]; then DB_PASS="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | cut -c1-32)"; fi
    ESC_PASS="${DB_PASS//\\/\\\\}"; ESC_PASS="${ESC_PASS//\'/\\\'}"
    info "Creating database '${DB_NAME}' and user '${DB_USER}'"
    $SQL <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${ESC_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${ESC_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
    ENC_PASS="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$DB_PASS")"
    DATABASE_URL="mysql://${DB_USER}:${ENC_PASS}@127.0.0.1:3306/${DB_NAME}"
    (umask 077; printf 'DATABASE_URL=%s\n' "$DATABASE_URL" >"$CRED_FILE")
    # Verify the new credentials work over TCP, as the application will connect.
    $SQL -h 127.0.0.1 -u "$DB_USER" -p"$DB_PASS" -e "SELECT 1" "$DB_NAME" >/dev/null || die "Could not connect with the new database credentials."
  fi
fi

# ── Summary ─────────────────────────────────────────────────────────────────
cat <<MSG

Preparation complete.
  Node.js   $(node -v)   npm $(npm -v)
  Chromium  $("$CHROMIUM_BIN" --version 2>/dev/null || echo "$CHROMIUM_BIN")   path: $CHROMIUM_BIN
  MariaDB   $( (mariadb --version || mysql --version) 2>/dev/null | head -n1 )
MSG
if [[ -n "$DATABASE_URL" ]]; then
  cat <<MSG
  DATABASE_URL saved to $CRED_FILE (root-only):
    $DATABASE_URL
MSG
fi
cat <<MSG

Next:
  git clone <your-repo-url> /opt/techtix-whatsapp
  cd /opt/techtix-whatsapp && sudo ./install.sh
  (enter the DATABASE_URL when asked; browser path: $CHROMIUM_BIN)
MSG
