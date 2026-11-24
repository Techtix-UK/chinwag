#!/usr/bin/env bash
# Shared helpers for Chinwag operational scripts (update, backup, restore, doctor, CLI).
# Installation paths come from /etc/chinwag/chinwag.conf, written by install.sh. Installs that predate
# the rename (Techtix WhatsApp) are detected automatically and keep their original paths and names.
set -Eeuo pipefail

CHINWAG_CONF="${CHINWAG_CONF:-/etc/chinwag/chinwag.conf}"

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_ORANGE=$'\033[38;5;202m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_ORANGE=''; C_GREEN=''; C_RED=''; C_YELLOW=''
fi
info() { printf '%s==>%s %s\n' "$C_ORANGE$C_BOLD" "$C_RESET" "$*"; }
ok() { printf '%s ✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s !%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die() { printf '%s ✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

confirm() {
  [[ "${ASSUME_YES:-0}" == "1" ]] && return 0
  local reply; read -r -p "$1 [y/N] " reply </dev/tty || return 1
  [[ "$reply" =~ ^[Yy]$ ]]
}
require_root() { [[ $EUID -eq 0 ]] || die "Run this as root (sudo)."; }

load_install_config() {
  if [[ -f "$CHINWAG_CONF" ]]; then
    # shellcheck disable=SC1090
    source "$CHINWAG_CONF"
  elif id techtix-whatsapp >/dev/null 2>&1 && [[ -d /opt/techtix-whatsapp ]]; then
    # Legacy (pre-rename) layout.
    APP_DIR=/opt/techtix-whatsapp SERVICE_USER=techtix-whatsapp PM2_NAME=techtix-whatsapp
    LOG_DIR=/var/log/techtix-whatsapp BACKUP_DIR=/var/backups/techtix-whatsapp
  fi
  APP_DIR="${APP_DIR:-/opt/chinwag}"
  SERVICE_USER="${SERVICE_USER:-chinwag}"
  PM2_NAME="${PM2_NAME:-chinwag}"
  LOG_DIR="${LOG_DIR:-/var/log/chinwag}"
  BACKUP_DIR="${BACKUP_DIR:-/var/backups/chinwag}"
  BACKUP_PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/root/.chinwag-backup-passphrase}"
  if [[ ! -f "$BACKUP_PASSPHRASE_FILE" && -f /root/.techtix-whatsapp-backup-passphrase ]]; then BACKUP_PASSPHRASE_FILE=/root/.techtix-whatsapp-backup-passphrase; fi
  DATA_DIR="$(env_get DATA_DIR)"; DATA_DIR="${DATA_DIR:-/var/lib/chinwag}"
  export APP_DIR SERVICE_USER PM2_NAME LOG_DIR BACKUP_DIR BACKUP_PASSPHRASE_FILE DATA_DIR
}

write_install_config() {
  install -d -m 755 "$(dirname "$CHINWAG_CONF")"
  cat >"$CHINWAG_CONF" <<CONF
# Written by Chinwag install.sh — paths used by the chinwag CLI and scripts.
APP_DIR=$APP_DIR
SERVICE_USER=$SERVICE_USER
PM2_NAME=$PM2_NAME
LOG_DIR=$LOG_DIR
BACKUP_DIR=$BACKUP_DIR
BACKUP_PASSPHRASE_FILE=$BACKUP_PASSPHRASE_FILE
CONF
  chmod 644 "$CHINWAG_CONF"
}

env_get() {
  local key="$1" file="${2:-${APP_DIR:-/opt/chinwag}/.env}"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true
}

service_home() { getent passwd "$SERVICE_USER" | cut -d: -f6; }
as_service() { sudo -u "$SERVICE_USER" -H env HOME="$(service_home)" PUPPETEER_SKIP_DOWNLOAD=1 SCARF_ANALYTICS=false "$@"; }
pm2_service() { as_service pm2 "$@"; }

parse_db_url() {
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
  local f; f="$(mktemp)"; chmod 600 "$f"
  printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$DB_USER" "$DB_PASS" "$DB_HOST" "$DB_PORT" >"$f"
  echo "$f"
}

app_version() { node -p "require('$APP_DIR/package.json').version" 2>/dev/null || echo unknown; }
