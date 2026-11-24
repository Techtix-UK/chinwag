#!/usr/bin/env bash
#
#   Chinwag installer — self-hosted WhatsApp inbox, REST API and MCP server.  By Techtix.
#   https://github.com/Techtix-UK/chinwag
#
#   curl -fsSL https://raw.githubusercontent.com/Techtix-UK/chinwag/main/install.sh | sudo bash
#
#   Supported: Debian 12/13, Ubuntu 22.04/24.04/26.04 (amd64; arm64 on Debian).
#   Re-running on an existing installation is safe: it repairs/updates instead of reinstalling.
#
#   Options (or the matching CHINWAG_* environment variables for unattended installs):
#     --domain DOMAIN         Public hostname, e.g. chat.example.com            (CHINWAG_DOMAIN)
#     --email EMAIL           Let's Encrypt contact email (Caddy/Nginx)         (CHINWAG_EMAIL)
#     --proxy MODE            caddy | nginx | cloudflare | none                 (CHINWAG_PROXY)
#     --db MODE               auto | local | docker | external                  (CHINWAG_DB)
#     --database-url URL      Existing MySQL/MariaDB database (with --db external)  (CHINWAG_DATABASE_URL)
#     --dir PATH              Install directory (default /opt/chinwag)          (CHINWAG_DIR)
#     --data-dir PATH         Data directory (default /var/lib/chinwag)         (CHINWAG_DATA_DIR)
#     --port PORT             Local port (default 3100)                          (CHINWAG_PORT)
#     --ref REF               Git tag/branch to install (default: latest release, else main)  (CHINWAG_REF)
#     --repo URL              Git repository (default GitHub)                   (CHINWAG_REPO)
#     -y, --yes               Accept defaults and confirmations (non-interactive)
#
set -Eeuo pipefail

# ─────────────────────────────── settings ───────────────────────────────
REPO="${CHINWAG_REPO:-https://github.com/Techtix-UK/chinwag.git}"
APP_DIR="${CHINWAG_DIR:-/opt/chinwag}"
DATA_DIR="${CHINWAG_DATA_DIR:-/var/lib/chinwag}"
LOG_DIR=/var/log/chinwag
BACKUP_DIR=/var/backups/chinwag
SERVICE_USER=chinwag
PM2_NAME=chinwag
PORT="${CHINWAG_PORT:-3100}"
DOMAIN="${CHINWAG_DOMAIN:-}"
EMAIL="${CHINWAG_EMAIL:-}"
PROXY="${CHINWAG_PROXY:-}"
DB_MODE="${CHINWAG_DB:-auto}"
DATABASE_URL="${CHINWAG_DATABASE_URL:-}"
REF="${CHINWAG_REF:-}"
ASSUME_YES="${CHINWAG_YES:-0}"
INSTALL_LOG=/var/log/chinwag-install.log
NODE_MAJOR=22
DOCKER_DB_PORT=3307

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift ;;
    --email) EMAIL="$2"; shift ;;
    --proxy) PROXY="$2"; shift ;;
    --db) DB_MODE="$2"; shift ;;
    --database-url) DATABASE_URL="$2"; DB_MODE=external; shift ;;
    --dir) APP_DIR="$2"; shift ;;
    --data-dir) DATA_DIR="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --ref) REF="$2"; shift ;;
    --repo) REPO="$2"; shift ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,26p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

# ─────────────────────────────── output ───────────────────────────────
if [[ -t 1 ]]; then
  R=$'\033[0m' B=$'\033[1m' D=$'\033[2m' O=$'\033[38;5;202m' G=$'\033[32m' Y=$'\033[33m' RED=$'\033[31m' M=$'\033[38;5;17m'
else R='' B='' D='' O='' G='' Y='' RED='' M=''; fi
STEP=0
step() { STEP=$((STEP + 1)); printf '\n%s[%d/10]%s %s%s%s\n' "$O$B" "$STEP" "$R" "$B" "$*" "$R"; }
info() { printf '   %s\n' "$*"; }
ok() { printf '   %s✓%s %s\n' "$G" "$R" "$*"; }
warn() { printf '   %s!%s %s\n' "$Y" "$R" "$*" >&2; }
die() { printf '\n%s✗ %s%s\n   Full log: %s\n' "$RED$B" "$*" "$R" "$INSTALL_LOG" >&2; exit 1; }
trap 'die "Installation failed at line $LINENO (see log)."' ERR
run() { "$@" >>"$INSTALL_LOG" 2>&1; }   # quiet, logged

TTY=0; [[ -r /dev/tty && "$ASSUME_YES" != "1" ]] && TTY=1
ask() { # ask VAR "Question" "default"
  local __v="$1" q="$2" def="${3:-}" a=""
  if [[ $TTY == 1 ]]; then read -r -p "   $q${def:+ [$def]}: " a </dev/tty || true; fi
  printf -v "$__v" '%s' "${a:-$def}"
}
confirm() { [[ $TTY == 0 ]] && return 0; local a; read -r -p "   $1 [Y/n] " a </dev/tty || true; [[ ! "$a" =~ ^[Nn] ]]; }
choose() { # choose VAR "Question" default option...
  local __v="$1" q="$2" def="$3"; shift 3
  if [[ $TTY == 0 ]]; then printf -v "$__v" '%s' "$def"; return; fi
  printf '   %s\n' "$q"; local i=1 o; for o in "$@"; do printf '     %s%d)%s %s\n' "$O" "$i" "$R" "$o"; i=$((i + 1)); done
  local a; read -r -p "   Choice [$def]: " a </dev/tty || true
  if [[ "$a" =~ ^[0-9]+$ ]] && ((a >= 1 && a <= $#)); then a="${!a}"; a="${a%% *}"; fi
  printf -v "$__v" '%s' "${a:-$def}"
}

banner() {
  printf '%s' "$O$B"
  cat <<'ART'

     ██████╗██╗  ██╗██╗███╗   ██╗██╗    ██╗ █████╗  ██████╗
    ██╔════╝██║  ██║██║████╗  ██║██║    ██║██╔══██╗██╔════╝
    ██║     ███████║██║██╔██╗ ██║██║ █╗ ██║███████║██║  ███╗
    ██║     ██╔══██║██║██║╚██╗██║██║███╗██║██╔══██║██║   ██║
    ╚██████╗██║  ██║██║██║ ╚████║╚███╔███╔╝██║  ██║╚██████╔╝
     ╚═════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚══╝╚══╝ ╚═╝  ╚═╝ ╚═════╝
ART
  printf '%s    Self-hosted WhatsApp inbox · REST API · MCP server for AI   %sby Techtix%s\n\n' "$R" "$D" "$R"
}

# ─────────────────────────────── preflight ───────────────────────────────
banner
[[ $EUID -eq 0 ]] || { echo "Please run as root: curl -fsSL … | sudo bash" >&2; exit 1; }
: >"$INSTALL_LOG"; chmod 600 "$INSTALL_LOG"
echo "Chinwag install $(date -u)" >>"$INSTALL_LOG"

step "Checking this server"
. /etc/os-release
OS_ID="${ID:-}"; OS_VER="${VERSION_ID:-}"; ARCH="$(dpkg --print-architecture)"
case "$OS_ID" in
  debian) [[ "${OS_VER%%.*}" -ge 12 ]] || die "Debian 12 or newer is required (found $PRETTY_NAME)." ;;
  ubuntu) [[ "${OS_VER%%.*}" -ge 22 ]] || die "Ubuntu 22.04 or newer is required (found $PRETTY_NAME)." ;;
  *) die "Unsupported OS: ${PRETTY_NAME:-unknown}. Use Debian 12+/Ubuntu 22.04+." ;;
esac
[[ "$ARCH" == amd64 || "$ARCH" == arm64 ]] || die "Unsupported architecture $ARCH."
[[ "$OS_ID" == ubuntu && "$ARCH" == arm64 ]] && die "Ubuntu on arm64 only ships Chromium as a snap, which cannot run as a service. Use Debian on arm64."
[[ -d /usr/local/directadmin ]] && warn "DirectAdmin detected — the installer will not touch its web server; use the DirectAdmin proxy guide."
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
disk_gb=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
ok "$PRETTY_NAME ($ARCH), ${mem_mb} MB RAM, ${disk_gb} GB free"
((mem_mb >= 1800)) || warn "At least 2 GB RAM is recommended (each WhatsApp account runs its own browser, ~300 MB)."
((disk_gb >= 5)) || warn "At least 5 GB free disk is recommended."

if [[ -f /opt/techtix-whatsapp/.env && "$APP_DIR" == /opt/chinwag ]]; then
  die "This server runs an installation from before the rename (/opt/techtix-whatsapp). See https://techtix-uk.github.io/chinwag/operations/upgrading"
fi
EXISTING=0
if [[ -f "$APP_DIR/.env" ]]; then EXISTING=1; fi
if [[ $EXISTING == 1 ]]; then
  ok "Existing installation found in $APP_DIR — repairing/updating it (data and settings are kept)."
fi

# ─────────────────────────────── questions ───────────────────────────────
step "Configuration"
if [[ $EXISTING == 0 ]]; then
  [[ -n "$DOMAIN" ]] || ask DOMAIN "Public hostname (e.g. chat.example.com, leave empty for local only)" ""
  if [[ -z "$PROXY" ]]; then
    if [[ -z "$DOMAIN" ]]; then PROXY=none
    elif ss -ltnH 'sport = :443' 2>/dev/null | grep -q . || ss -ltnH 'sport = :80' 2>/dev/null | grep -q .; then
      warn "Something is already listening on port 80/443 — not installing a web server."
      choose PROXY "How will HTTPS reach Chinwag?" cloudflare "cloudflare  (Cloudflare Tunnel)" "none        (I'll configure my existing proxy)"
    else
      choose PROXY "How should HTTPS be provided?" caddy "caddy       (automatic HTTPS, recommended)" "nginx       (Nginx + Let's Encrypt certbot)" "cloudflare  (Cloudflare Tunnel, no open ports)" "none        (I'll configure a proxy myself)"
    fi
  fi
  if [[ "$PROXY" == caddy || "$PROXY" == nginx ]] && [[ -z "$EMAIL" ]]; then ask EMAIL "Email for Let's Encrypt certificate notices" ""; fi
  if [[ "$DB_MODE" == external && -z "$DATABASE_URL" ]]; then ask DATABASE_URL "DATABASE_URL (mysql://user:pass@host:3306/db)" ""; fi
  BASE_URL="http://127.0.0.1:$PORT"; [[ -n "$DOMAIN" ]] && BASE_URL="https://$DOMAIN"
  info "Install dir ${B}$APP_DIR${R} · data ${B}$DATA_DIR${R} · URL ${B}$BASE_URL${R} · proxy ${B}$PROXY${R} · database ${B}$DB_MODE${R}"
  confirm "Continue?" || exit 1
fi

export DEBIAN_FRONTEND=noninteractive
step "Installing system packages"
run apt-get update -q
run apt-get install -y -q ca-certificates curl gnupg git openssl sudo jq iproute2 fonts-liberation fonts-noto-color-emoji
ok "Base packages"
node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>=22||(a===20&&b>=19)?0:1)'; }
if ! node_ok; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  run apt-get update -q; run apt-get install -y -q nodejs
  node_ok || die "Node.js installation failed."
fi
ok "Node.js $(node -v)"
command -v pm2 >/dev/null || run npm install -g pm2@latest
ok "PM2 $(pm2 -v 2>/dev/null | tail -1)"

# Browser: Ubuntu's chromium is a snap (unusable by a service user) → Google Chrome; Debian → chromium .deb.
CHROMIUM_PATH=""
if [[ "$OS_ID" == ubuntu || ( "$ARCH" == amd64 && "$(command -v google-chrome-stable || true)" != "" ) ]]; then
  if ! command -v google-chrome-stable >/dev/null; then
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /etc/apt/keyrings/google-chrome.gpg
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" >/etc/apt/sources.list.d/google-chrome.list
    run apt-get update -q; run apt-get install -y -q google-chrome-stable
  fi
  CHROMIUM_PATH="$(command -v google-chrome-stable)"
else
  run apt-get install -y -q chromium
  CHROMIUM_PATH="$(command -v chromium)"
fi
ok "Browser $("$CHROMIUM_PATH" --version 2>/dev/null)"
if [[ -f /proc/sys/kernel/unprivileged_userns_clone && "$(cat /proc/sys/kernel/unprivileged_userns_clone)" != 1 ]]; then
  echo 'kernel.unprivileged_userns_clone=1' >/etc/sysctl.d/99-chinwag-chromium-sandbox.conf; run sysctl --system
  ok "Enabled unprivileged user namespaces for the browser sandbox"
fi

# ─────────────────────────────── service user & code ───────────────────────────────
step "Creating service user and fetching Chinwag"
id "$SERVICE_USER" >/dev/null 2>&1 || run useradd --system --create-home --home-dir "/home/$SERVICE_USER" --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR" "$DATA_DIR/sessions" "$DATA_DIR/media" "$DATA_DIR/tmp"
install -d -m 750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$LOG_DIR"
install -d -m 700 "$BACKUP_DIR"
ok "User $SERVICE_USER, data $DATA_DIR (700)"
git config --system --get-all safe.directory 2>/dev/null | grep -qx "$APP_DIR" || git config --system --add safe.directory "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  ok "Using existing checkout in $APP_DIR"
else
  [[ -e "$APP_DIR" && -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]] && die "$APP_DIR exists and is not a Chinwag checkout."
  run git clone --quiet "$REPO" "$APP_DIR"
  if [[ -z "$REF" ]]; then REF="$(git -C "$APP_DIR" tag --list 'v*' --sort=-v:refname | head -n1)"; fi
  [[ -n "$REF" ]] && run git -C "$APP_DIR" checkout --quiet "$REF"
  ok "Cloned $(git -C "$APP_DIR" describe --tags --always)"
fi
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"
as_service() { sudo -u "$SERVICE_USER" -H env HOME="/home/$SERVICE_USER" PUPPETEER_SKIP_DOWNLOAD=1 SCARF_ANALYTICS=false "$@"; }

# ─────────────────────────────── database ───────────────────────────────
step "Database"
db_running_outside_apt() {
  [[ "$(dpkg-query -W -f='${Status}' mariadb-server 2>/dev/null)" != "install ok installed" && "$(dpkg-query -W -f='${Status}' mysql-server 2>/dev/null)" != "install ok installed" ]] &&
    { pgrep -x mysqld >/dev/null || pgrep -x mariadbd >/dev/null || ss -ltnH 'sport = :3306' | grep -q .; }
}
if [[ $EXISTING == 1 ]]; then
  ok "Keeping the database configured in .env"
else
  if [[ "$DB_MODE" == auto ]]; then
    if db_running_outside_apt; then
      if command -v docker >/dev/null; then DB_MODE=docker; warn "Another MySQL/MariaDB is already running here — using a dedicated Docker container instead."
      else die "Another MySQL/MariaDB server is running that apt does not manage. Re-run with --database-url mysql://… (create a utf8mb4 database first)."; fi
    else DB_MODE=local; fi
  fi
  DB_PASS="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | cut -c1-32)"
  case "$DB_MODE" in
    local)
      run apt-get install -y -q mariadb-server mariadb-client
      run systemctl enable --now mariadb
      mariadb <<SQL >>"$INSTALL_LOG" 2>&1
CREATE DATABASE IF NOT EXISTS chinwag CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'chinwag'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER 'chinwag'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON chinwag.* TO 'chinwag'@'localhost';
FLUSH PRIVILEGES;
SQL
      DATABASE_URL="mysql://chinwag:${DB_PASS}@127.0.0.1:3306/chinwag"
      ok "MariaDB $(mariadb --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1) with database 'chinwag'" ;;
    docker)
      command -v docker >/dev/null || die "Docker is not installed."
      run apt-get install -y -q mariadb-client || true
      if ! docker inspect chinwag-mariadb >/dev/null 2>&1; then
        run docker run -d --name chinwag-mariadb --restart unless-stopped -p 127.0.0.1:${DOCKER_DB_PORT}:3306 -v chinwag-mariadb:/var/lib/mysql \
          -e MARIADB_RANDOM_ROOT_PASSWORD=1 -e MARIADB_DATABASE=chinwag -e MARIADB_USER=chinwag -e MARIADB_PASSWORD="$DB_PASS" \
          mariadb:11.8 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
      else die "A chinwag-mariadb container already exists; pass its URL with --database-url."; fi
      for _ in $(seq 1 30); do mariadb -h 127.0.0.1 -P $DOCKER_DB_PORT -u chinwag -p"$DB_PASS" -e 'SELECT 1' chinwag >/dev/null 2>&1 && break; sleep 2; done
      DATABASE_URL="mysql://chinwag:${DB_PASS}@127.0.0.1:${DOCKER_DB_PORT}/chinwag"
      ok "MariaDB 11.8 container 'chinwag-mariadb' on 127.0.0.1:$DOCKER_DB_PORT" ;;
    external)
      [[ "$DATABASE_URL" =~ ^mysql:// ]] || die "--database-url must be a mysql:// URL."
      run apt-get install -y -q mariadb-client || true
      ok "Using external database" ;;
    *) die "Unknown --db mode $DB_MODE" ;;
  esac
  (umask 077; echo "DATABASE_URL=$DATABASE_URL" >/root/chinwag-database.txt)
fi

# ─────────────────────────────── configuration ───────────────────────────────
step "Writing configuration"
if [[ $EXISTING == 0 ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  KEY="$(openssl rand -base64 32)"; TOKEN="$(openssl rand -hex 16)"
  node -e '
    const fs = require("fs"); const file = process.argv[1]; let s = fs.readFileSync(file, "utf8");
    const set = (k, v) => { const re = new RegExp("^" + k + "=.*$", "m"); s = re.test(s) ? s.replace(re, () => k + "=" + v) : s + "\n" + k + "=" + v; };
    const [, , base, port, db, key, token, chrome, data, trust] = process.argv;
    set("NODE_ENV", "production"); set("BASE_URL", base); set("HOST", "127.0.0.1"); set("PORT", port); set("DATABASE_URL", db);
    set("APP_ENCRYPTION_KEY", key); set("SETUP_TOKEN", token); set("CHROMIUM_PATH", chrome); set("DATA_DIR", data); set("TRUST_PROXY", trust);
    fs.writeFileSync(file, s);
  ' "$APP_DIR/.env" "$BASE_URL" "$PORT" "$DATABASE_URL" "$KEY" "$TOKEN" "$CHROMIUM_PATH" "$DATA_DIR" "$([[ "$PROXY" == none && -z "$DOMAIN" ]] && echo 0 || echo 1)"
  ok "Created $APP_DIR/.env (encryption key and setup token generated)"
else
  ok "Keeping existing $APP_DIR/.env"
fi
chown root:"$SERVICE_USER" "$APP_DIR/.env"; chmod 640 "$APP_DIR/.env"
grep -qE '^DATABASE_URL=mysql://' "$APP_DIR/.env" || die ".env DATABASE_URL is not a mysql:// URL."
install -d -m 755 /etc/chinwag
cat >/etc/chinwag/chinwag.conf <<CONF
# Written by the Chinwag installer — paths used by the chinwag CLI.
APP_DIR=$APP_DIR
SERVICE_USER=$SERVICE_USER
PM2_NAME=$PM2_NAME
LOG_DIR=$LOG_DIR
BACKUP_DIR=$BACKUP_DIR
BACKUP_PASSPHRASE_FILE=/root/.chinwag-backup-passphrase
CONF
[[ -s /root/.chinwag-backup-passphrase ]] || (umask 077; openssl rand -base64 48 >/root/.chinwag-backup-passphrase)
ln -sf "$APP_DIR/scripts/chinwag" /usr/local/bin/chinwag

# ─────────────────────────────── build ───────────────────────────────
step "Building Chinwag (a few minutes)"
(cd "$APP_DIR" && as_service npm ci --no-audit --no-fund --loglevel=error -w server -w web --include-workspace-root >>"$INSTALL_LOG" 2>&1) || die "npm ci failed."
ok "Dependencies installed"
(cd "$APP_DIR" && as_service npm run build >>"$INSTALL_LOG" 2>&1) || die "Build failed."
ok "Built"
(cd "$APP_DIR/server" && as_service npx prisma migrate deploy >>"$INSTALL_LOG" 2>&1) || die "Database migrations failed (check DATABASE_URL)."
ok "Database migrations applied"

step "Starting the service"
cd "$APP_DIR"
if as_service pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  run as_service pm2 restart "$PM2_NAME" --update-env
else
  run as_service env CHINWAG_PM2_NAME="$PM2_NAME" CHINWAG_LOG_DIR="$LOG_DIR" pm2 start ecosystem.config.cjs
fi
run as_service pm2 save
run env PATH="$PATH" pm2 startup systemd -u "$SERVICE_USER" --hp "/home/$SERVICE_USER"
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1 || die "Chinwag did not start — run: chinwag logs"
ok "Running on 127.0.0.1:$PORT (PM2 '$PM2_NAME', starts at boot)"

# ─────────────────────────────── HTTPS ───────────────────────────────
step "HTTPS"
if [[ $EXISTING == 1 ]]; then
  ok "Leaving existing proxy configuration unchanged"
else
  case "$PROXY" in
    caddy)
      if ! command -v caddy >/dev/null; then
        install -d -m 0755 /etc/apt/keyrings
        curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /etc/apt/keyrings/caddy-stable.gpg
        echo "deb [signed-by=/etc/apt/keyrings/caddy-stable.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" >/etc/apt/sources.list.d/caddy-stable.list
        run apt-get update -q; run apt-get install -y -q caddy
      fi
      install -d /etc/caddy/sites
      cat >/etc/caddy/sites/chinwag.caddy <<CADDY
$DOMAIN {
	${EMAIL:+tls $EMAIL}
	encode zstd gzip
	request_body {
		max_size 150MB
	}
	@mcp path /mcp
	reverse_proxy @mcp 127.0.0.1:$PORT {
		flush_interval -1
	}
	reverse_proxy 127.0.0.1:$PORT
}
CADDY
      if ! grep -q 'import /etc/caddy/sites/\*' /etc/caddy/Caddyfile 2>/dev/null; then
        if grep -qE '^:80 *\{' /etc/caddy/Caddyfile 2>/dev/null && [[ $(grep -cvE '^\s*(#|$)' /etc/caddy/Caddyfile) -le 12 ]]; then
          printf '# Managed by Chinwag installer\nimport /etc/caddy/sites/*\n' >/etc/caddy/Caddyfile   # replace the stock example site
        else
          printf '\nimport /etc/caddy/sites/*\n' >>/etc/caddy/Caddyfile
        fi
      fi
      run caddy validate --config /etc/caddy/Caddyfile || die "Caddy configuration is invalid."
      run systemctl enable caddy; run systemctl reload-or-restart caddy
      ok "Caddy serves https://$DOMAIN (certificate is issued on first request once DNS points here)" ;;
    nginx)
      run apt-get install -y -q nginx certbot python3-certbot-nginx
      sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" "$APP_DIR/deploy/nginx/chinwag-http.conf" >/etc/nginx/sites-available/chinwag.conf
      ln -sf /etc/nginx/sites-available/chinwag.conf /etc/nginx/sites-enabled/chinwag.conf
      run nginx -t || die "Nginx configuration test failed."
      run systemctl reload nginx
      if certbot --nginx -n --agree-tos ${EMAIL:+-m "$EMAIL"} ${EMAIL:---register-unsafely-without-email} -d "$DOMAIN" --redirect >>"$INSTALL_LOG" 2>&1; then
        ok "Nginx + Let's Encrypt for https://$DOMAIN"
      else
        warn "Certificate request failed (DNS not pointing here yet?). Later run: certbot --nginx -d $DOMAIN --redirect"
      fi ;;
    cloudflare)
      ok "Use a Cloudflare Tunnel public hostname: $DOMAIN → http://127.0.0.1:$PORT (see docs: Reverse proxy → Cloudflare)" ;;
    *) ok "No proxy installed. Point your reverse proxy at http://127.0.0.1:$PORT (WebSockets on /socket.io, unbuffered /mcp)." ;;
  esac
fi

# ─────────────────────────────── done ───────────────────────────────
step "Done"
TOKEN="$(grep -E '^SETUP_TOKEN=' "$APP_DIR/.env" | cut -d= -f2-)"
URL="$(grep -E '^BASE_URL=' "$APP_DIR/.env" | cut -d= -f2-)"
cat <<DONE

  ${G}${B}Chinwag is installed.${R}

  ${B}Next:${R} open ${O}${URL}/setup${R} and enter the setup token:
      ${B}${TOKEN:-(setup already completed)}${R}

  ${B}Manage:${R}  chinwag status · chinwag logs · chinwag doctor · chinwag update · chinwag backup --stop
  ${B}Keep safe:${R} APP_ENCRYPTION_KEY in $APP_DIR/.env and /root/.chinwag-backup-passphrase
  ${B}Docs:${R}    https://techtix-uk.github.io/chinwag/

  ${D}Chinwag uses WhatsApp Web through the unofficial whatsapp-web.js library. It is not affiliated
  with WhatsApp or Meta. Only message people who expect to hear from you.${R}

DONE
