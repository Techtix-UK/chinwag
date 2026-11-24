#!/usr/bin/env bash
# Chinwag — health check of the installation. Read-only.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_root
load_install_config
FAIL=0
check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else printf '%s ✗%s %s%s\n' "$C_RED" "$C_RESET" "$1" "${3:+ — $3}"; FAIL=1; fi; }

printf '\n%sChinwag doctor%s  %s\n\n' "$C_BOLD" "$C_RESET" "$APP_DIR"
check "Install directory exists" "[[ -d '$APP_DIR' ]]"
check ".env present and private" "[[ -f '$APP_DIR/.env' && \$(stat -c %a '$APP_DIR/.env') =~ ^6[04]0$ ]]" "chmod 640 $APP_DIR/.env"
check "Service user $SERVICE_USER exists" "id '$SERVICE_USER'"
check "Data directory is private (700)" "[[ \$(stat -c %a '$DATA_DIR') == 700 ]]" "chmod 700 $DATA_DIR"
check "Node.js >= 20.19" "node -e 'const [a,b]=process.versions.node.split(\".\").map(Number);process.exit(a>=22||(a===20&&b>=19)?0:1)'"
CHROME="$(env_get CHROMIUM_PATH)"
check "Browser at ${CHROME:-?}" "[[ -x '$CHROME' ]] && '$CHROME' --version" "install Google Chrome / Chromium and set CHROMIUM_PATH"
check "PM2 process '$PM2_NAME' online" "pm2_service jlist | grep -q '\"name\":\"$PM2_NAME\".*\"status\":\"online\"'" "chinwag logs"
check "PM2 starts at boot" "systemctl is-enabled pm2-$SERVICE_USER" "pm2 startup systemd -u $SERVICE_USER --hp $(service_home)"
PORT="$(env_get PORT)"; PORT="${PORT:-3100}"
check "Local health endpoint (127.0.0.1:$PORT)" "curl -fsS http://127.0.0.1:$PORT/api/v1/health | grep -q '\"status\":\"ok\"'" "chinwag logs"
BASE="$(env_get BASE_URL)"
if [[ "$BASE" == https://* ]]; then
  check "Public URL reachable ($BASE)" "curl -fsS --max-time 10 '$BASE/api/v1/health'" "check DNS, reverse proxy / tunnel and firewall"
  check "MCP OAuth metadata published" "curl -fsS --max-time 10 '$BASE/.well-known/oauth-protected-resource/mcp' | grep -q resource"
  host="${BASE#https://}"; host="${host%%/*}"
  exp="$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  [[ -n "$exp" ]] && ok "TLS certificate valid until $exp"
fi
avail_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
check "Available memory ${avail_mb} MB (≥ 512 MB)" "[[ $avail_mb -ge 512 ]]" "each WhatsApp account needs ~300 MB"
free_gb=$(df -BG --output=avail "$DATA_DIR" | tail -1 | tr -dc 0-9)
check "Free disk ${free_gb} GB on data volume (≥ 2 GB)" "[[ $free_gb -ge 2 ]]"
check "Backup passphrase file exists" "[[ -s '$BACKUP_PASSPHRASE_FILE' ]]" "run: chinwag backup"
last="$(ls -1t "$BACKUP_DIR"/*.tar.gz.enc 2>/dev/null | head -1 || true)"
if [[ -n "$last" ]]; then ok "Latest backup: $(basename "$last")"; else warn "No backups found in $BACKUP_DIR — schedule: chinwag backup --stop"; fi
echo
[[ $FAIL == 0 ]] && ok "All checks passed" || { warn "Some checks failed"; exit 1; }
