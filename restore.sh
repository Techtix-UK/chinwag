#!/usr/bin/env bash
# Compatibility wrapper — use the `chinwag` command instead (chinwag restore …).
exec bash "$(dirname "$(readlink -f "$0")")/scripts/restore.sh" "$@"
