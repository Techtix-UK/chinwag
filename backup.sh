#!/usr/bin/env bash
# Compatibility wrapper — use the `chinwag` command instead (chinwag backup …).
exec bash "$(dirname "$(readlink -f "$0")")/scripts/backup.sh" "$@"
