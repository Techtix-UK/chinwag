#!/usr/bin/env bash
# Compatibility wrapper — use the `chinwag` command instead (chinwag update …).
exec bash "$(dirname "$(readlink -f "$0")")/scripts/update.sh" "$@"
