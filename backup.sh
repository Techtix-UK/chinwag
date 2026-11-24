#!/usr/bin/env bash
# Techtix WhatsApp — encrypted backup.
#
# Creates /var/backups/techtix-whatsapp/techtix-whatsapp-<timestamp>.tar.gz.enc containing:
#   database.sql (consistent mysqldump --single-transaction), sessions/ (WhatsApp auth),
#   media/, env (the .env file) and manifest.json.
# Encryption: AES-256 (openssl, PBKDF2 600k iterations) with the passphrase in $BACKUP_PASSPHRASE_FILE
# (default /root/.techtix-whatsapp-backup-passphrase, mode 600). Keep that passphrase AND the
# APP_ENCRYPTION_KEY somewhere other than the backup destination.
#
# Options:
#   --stop       Stop the app while copying WhatsApp sessions (guarantees consistent Chromium profiles; recommended nightly)
#   --db-only    Only the database and .env
#   --keep N     Keep the newest N backups (default 14)
set -Eeuo pipefail
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
source deploy/common.sh
require_root

STOP=0; DB_ONLY=0; KEEP=14
while [[ $# -gt 0 ]]; do case "$1" in --stop) STOP=1 ;; --db-only) DB_ONLY=1 ;; --keep) KEEP="$2"; shift ;; *) die "Unknown option $1" ;; esac; shift; done

PASS_FILE="${BACKUP_PASSPHRASE_FILE:-/root/.techtix-whatsapp-backup-passphrase}"
if [[ ! -s "$PASS_FILE" ]]; then
  c_warn "No backup passphrase at $PASS_FILE — generating one. STORE IT SAFELY OFF-SERVER; backups cannot be restored without it."
  (umask 077; openssl rand -base64 48 >"$PASS_FILE")
fi
[[ "$(stat -c %a "$PASS_FILE" 2>/dev/null || stat -f %Lp "$PASS_FILE")" == "600" ]] || chmod 600 "$PASS_FILE"

DATA_DIR="$(env_get DATA_DIR)"; DATA_DIR="${DATA_DIR:-$DATA_DIR_DEFAULT}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"; chmod 700 "$WORK"
trap 'rm -rf "$WORK"; [[ -n "${DEFAULTS:-}" ]] && rm -f "$DEFAULTS"' EXIT
install -d -m 700 "$BACKUP_DIR"

parse_db_url
DEFAULTS="$(mysql_defaults_file)"
c_info "Dumping database $DB_NAME"
DUMP=mysqldump; command -v mariadb-dump >/dev/null && DUMP=mariadb-dump
"$DUMP" --defaults-extra-file="$DEFAULTS" --single-transaction --quick --routines --triggers --default-character-set=utf8mb4 --no-tablespaces "$DB_NAME" >"$WORK/database.sql"
cp .env "$WORK/env"

STOPPED=0
if [[ $DB_ONLY == 0 ]]; then
  if [[ $STOP == 1 ]]; then c_info "Stopping the app for a consistent session copy"; pm2_service stop "$PM2_NAME" >/dev/null && STOPPED=1; fi
  c_info "Copying WhatsApp sessions and media"
  tar -C "$DATA_DIR" --exclude='*/Cache/*' --exclude='*/Code Cache/*' --exclude='*/GPUCache/*' --exclude='*/Service Worker/CacheStorage/*' -cf "$WORK/sessions.tar" sessions
  [[ $STOPPED == 1 ]] && { pm2_service start "$PM2_NAME" >/dev/null; c_info "App restarted"; }
  tar -C "$DATA_DIR" -cf "$WORK/media.tar" media
  [[ $STOP == 0 ]] && c_warn "Sessions were copied while running. If a restored session fails to authenticate, re-scan its QR code (use --stop for a fully consistent copy)."
fi

cat >"$WORK/manifest.json" <<JSON
{"app":"techtix-whatsapp","created_at":"$TS","host":"$(hostname)","db_only":$([[ $DB_ONLY == 1 ]] && echo true || echo false),"consistent_sessions":$([[ $STOP == 1 ]] && echo true || echo false),"git_ref":"$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"}
JSON

OUT="$BACKUP_DIR/techtix-whatsapp-$TS$([[ $DB_ONLY == 1 ]] && echo -db).tar.gz.enc"
(umask 077; tar -C "$WORK" -czf - . | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$PASS_FILE" -out "$OUT")
sha256sum "$OUT" >"$OUT.sha256" 2>/dev/null || shasum -a 256 "$OUT" >"$OUT.sha256"
c_info "Backup written: $OUT ($(du -h "$OUT" | cut -f1))"

# Retention
ls -1t "$BACKUP_DIR"/techtix-whatsapp-*.tar.gz.enc 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old" "$old.sha256"; done
c_info "Retained newest $KEEP backups. Copy backups off-server (e.g. rsync/rclone) for disaster recovery."
