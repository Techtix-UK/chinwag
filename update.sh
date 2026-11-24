#!/usr/bin/env bash
# Techtix WhatsApp — update to the latest code in this repository.
# Usage: sudo ./update.sh [--no-backup] [--ref <git ref>]
set -Eeuo pipefail
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
source deploy/common.sh
require_root

DO_BACKUP=1; REF=""
while [[ $# -gt 0 ]]; do case "$1" in --no-backup) DO_BACKUP=0 ;; --ref) REF="$2"; shift ;; *) die "Unknown option $1" ;; esac; shift; done

if [[ $DO_BACKUP == 1 ]]; then c_info "Creating a pre-update backup"; ./backup.sh --db-only; fi

if [[ -d .git ]]; then
  c_info "Fetching code"
  as_service git fetch --tags --prune
  if [[ -n "$REF" ]]; then as_service git checkout "$REF"; else as_service git pull --ff-only; fi
fi

c_info "Installing dependencies"; as_service npm ci --no-audit --no-fund
c_info "Building"; as_service npm run build
c_info "Applying migrations"; (cd server && as_service npx prisma migrate deploy)
c_info "Restarting (single instance — sessions reconnect automatically from stored credentials)"
pm2_service restart "$PM2_NAME" --update-env
pm2_service save
c_info "Update complete. Check: pm2 logs $PM2_NAME (as $SERVICE_USER) and /api/v1/health"
