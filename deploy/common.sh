#!/usr/bin/env bash
# Shared helpers for Techtix WhatsApp operational scripts.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/techtix-whatsapp}"
DATA_DIR_DEFAULT="/var/lib/techtix-whatsapp"
LOG_DIR="/var/log/techtix-whatsapp"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/techtix-whatsapp}"
SERVICE_USER="${SERVICE_USER:-techtix-whatsapp}"
PM2_NAME="techtix-whatsapp"

c_info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
c_warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
c_err() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; }
die() { c_err "$*"; exit 1; }

confirm() {
  # confirm "question" -> returns 0 for yes. ASSUME_YES=1 skips prompts (non-interactive use).
  if [[ "${ASSUME_YES:-0}" == "1" ]]; then return 0; fi
  local reply
  read -r -p "$1 [y/N] " reply </dev/tty || return 1
  [[ "$reply" =~ ^[Yy]$ ]]
}

require_root() { [[ $EUID -eq 0 ]] || die "Run this script as root (sudo)."; }

env_get() {
  # env_get KEY -> value from $APP_DIR/.env (no shell evaluation of the file)
  local key="$1" file="${2:-$APP_DIR/.env}"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

as_service() { sudo -u "$SERVICE_USER" -H env HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)" PUPPETEER_SKIP_DOWNLOAD=1 "$@"; }

pm2_service() { as_service pm2 "$@"; }

parse_db_url() {
  # Exports DB_USER DB_PASS DB_HOST DB_PORT DB_NAME from DATABASE_URL (mysql://user:pass@host:port/db)
  local url; url="$(env_get DATABASE_URL)"
  [[ -n "$url" ]] || die "DATABASE_URL is not set in $APP_DIR/.env"
  eval "$(node -e '
    const u = new URL(process.argv[1]);
    const q = (s) => "\x27" + String(s).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
    console.log(`DB_USER=${q(decodeURIComponent(u.username))} DB_PASS=${q(decodeURIComponent(u.password))} DB_HOST=${q(u.hostname)} DB_PORT=${q(u.port || 3306)} DB_NAME=${q(u.pathname.slice(1))}`);
  ' "$url")"
  export DB_USER DB_PASS DB_HOST DB_PORT DB_NAME
}

mysql_defaults_file() {
  # Writes a temporary client config so the password never appears in the process list.
  local f; f="$(mktemp)"; chmod 600 "$f"
  printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$DB_USER" "$DB_PASS" "$DB_HOST" "$DB_PORT" >"$f"
  echo "$f"
}
