#!/usr/bin/env bash
# Chinwag — update to the latest release (or a given git ref), safely.
# Usage: chinwag update [--ref <tag|branch|commit>] [--no-backup]
set -Eeuo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# git pull may replace this very file; run from a private copy so bash never reads a half-updated script.
if [[ -z "${CHINWAG_UPDATE_REEXEC:-}" ]]; then
  tmpdir="$(mktemp -d)"; cp "$SELF_DIR/update.sh" "$SELF_DIR/lib.sh" "$tmpdir/"
  CHINWAG_UPDATE_REEXEC=1 CHINWAG_SCRIPTS_SRC="$SELF_DIR" exec bash "$tmpdir/update.sh" "$@"
fi
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_root
load_install_config
cd "$APP_DIR"

DO_BACKUP=1; REF=""
while [[ $# -gt 0 ]]; do case "$1" in --no-backup) DO_BACKUP=0 ;; --ref) REF="$2"; shift ;; -y|--yes) ASSUME_YES=1 ;; *) die "Unknown option $1" ;; esac; shift; done

OLD="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [[ $DO_BACKUP == 1 ]]; then info "Pre-update database backup"; bash "$CHINWAG_SCRIPTS_SRC/backup.sh" --db-only --keep 10; fi

git config --system --get-all safe.directory 2>/dev/null | grep -qx "$APP_DIR" || git config --system --add safe.directory "$APP_DIR"
info "Fetching updates"
as_service git fetch --tags --prune --quiet
if [[ -n "$REF" ]]; then
  as_service git checkout --quiet "$REF"
elif as_service git symbolic-ref -q HEAD >/dev/null; then
  as_service git pull --ff-only --quiet
else
  # Detached at a release tag: move to the newest release tag.
  latest="$(as_service git tag --list 'v*' --sort=-v:refname | head -n1)"
  [[ -n "$latest" ]] && as_service git checkout --quiet "$latest"
fi
NEW="$(git rev-parse --short HEAD)"
if [[ "$OLD" == "$NEW" ]]; then ok "Already up to date ($NEW)"; else info "Updating $OLD → $NEW"; fi

info "Installing dependencies"; as_service npm ci --no-audit --no-fund --loglevel=error -w server -w web --include-workspace-root
info "Building"; as_service npm run build --silent
info "Applying database migrations"; (cd server && as_service npx prisma migrate deploy)
ln -sf "$APP_DIR/scripts/chinwag" /usr/local/bin/chinwag
info "Restarting (sessions reconnect from stored credentials)"
pm2_service restart "$PM2_NAME" --update-env >/dev/null
pm2_service save >/dev/null
sleep 4
port="$(env_get PORT)"; port="${port:-3100}"
if curl -fsS "http://127.0.0.1:$port/api/v1/health" >/dev/null; then ok "Chinwag $(app_version) ($NEW) is running"; else warn "Health check failed — run: chinwag logs"; fi
