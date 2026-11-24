#!/usr/bin/env bash
# Chinwag — restore from an encrypted backup (server migration or failure).
#
# Usage: chinwag restore /var/backups/chinwag/chinwag-<ts>.tar.gz.enc [--no-db] [--no-sessions] [--no-env]
#
# IMPORTANT: the server the backup came from MUST be stopped (or its sessions logged out) before
# restored sessions start here. Two servers using the same WhatsApp session will compete and may be
# logged out by WhatsApp. Restored sessions may still require re-authentication if WhatsApp revoked them.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_root
load_install_config
cd "$APP_DIR"

FILE="${1:-}"; shift || true
[[ -f "$FILE" ]] || die "Usage: $0 <backup.tar.gz.enc> [--no-db] [--no-sessions] [--no-env]"
DO_DB=1; DO_SESS=1; DO_ENV=1
while [[ $# -gt 0 ]]; do case "$1" in --no-db) DO_DB=0 ;; --no-sessions) DO_SESS=0 ;; --no-env) DO_ENV=0 ;; *) die "Unknown option $1" ;; esac; shift; done

if [[ -f "$FILE.sha256" ]]; then (cd "$(dirname "$FILE")" && (sha256sum -c "$(basename "$FILE").sha256" 2>/dev/null || shasum -a 256 -c "$(basename "$FILE").sha256")) || die "Checksum mismatch"; fi
PASS_FILE="$BACKUP_PASSPHRASE_FILE"
[[ -s "$PASS_FILE" ]] || die "Backup passphrase file $PASS_FILE not found"

WORK="$(mktemp -d)"; chmod 700 "$WORK"
trap 'rm -rf "$WORK"; [[ -n "${DEFAULTS:-}" ]] && rm -f "$DEFAULTS"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$PASS_FILE" -in "$FILE" | tar -C "$WORK" -xzf -
info "Backup manifest: $(cat "$WORK/manifest.json")"

warn "This will overwrite the current database/sessions/media of this installation."
confirm "Is the ORIGINAL server stopped so the restored WhatsApp sessions will not compete with it?" || die "Stop the original server first."
confirm "Proceed with restore?" || die "Aborted."

pm2_service stop "$PM2_NAME" >/dev/null 2>&1 || true

if [[ $DO_ENV == 1 && -f "$WORK/env" ]]; then
  [[ -f .env ]] && cp .env ".env.before-restore.$(date +%s)"
  cp "$WORK/env" .env; chown root:"$SERVICE_USER" .env; chmod 640 .env
  info ".env restored (review BASE_URL / DATABASE_URL / CHROMIUM_PATH for the new server)"
fi

DATA_DIR="$(env_get DATA_DIR)"; DATA_DIR="${DATA_DIR:-/var/lib/chinwag}"
install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"

if [[ $DO_DB == 1 ]]; then
  parse_db_url
  DEFAULTS="$(mysql_defaults_file)"
  CLIENT=mysql; command -v mariadb >/dev/null && CLIENT=mariadb
  info "Restoring database into $DB_NAME"
  "$CLIENT" --defaults-extra-file="$DEFAULTS" "$DB_NAME" <"$WORK/database.sql"
fi

if [[ $DO_SESS == 1 && -f "$WORK/sessions.tar" ]]; then
  [[ -d "$DATA_DIR/sessions" ]] && mv "$DATA_DIR/sessions" "$DATA_DIR/sessions.before-restore.$(date +%s)"
  tar -C "$DATA_DIR" -xf "$WORK/sessions.tar"
  info "Sessions restored"
fi
if [[ -f "$WORK/media.tar" ]]; then tar -C "$DATA_DIR" -xf "$WORK/media.tar"; info "Media restored"; fi
chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR"; chmod -R go-rwx "$DATA_DIR"

(cd server && as_service npx prisma migrate deploy)
pm2_service start "$PM2_NAME" >/dev/null 2>&1 || (cd "$APP_DIR" && as_service env CHINWAG_PM2_NAME="$PM2_NAME" CHINWAG_LOG_DIR="$LOG_DIR" pm2 start ecosystem.config.cjs >/dev/null)
pm2_service save >/dev/null
info "Restore complete. Check each account under WhatsApp Accounts; re-scan QR codes for any session WhatsApp has revoked."
