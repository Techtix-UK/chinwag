# The `chinwag` CLI

The installer links `/usr/local/bin/chinwag`. Run it with `sudo`.

| Command | What it does |
|---|---|
| `chinwag status` | Process status and health |
| `chinwag logs [-f] [N]` | Last *N* log lines (default 100), `-f` to follow |
| `chinwag start` · `stop` · `restart` | Control the service (PM2, starts at boot) |
| `chinwag update [--ref v1.2.0]` | Back up the database, fetch the latest release, rebuild, migrate and restart |
| `chinwag backup [--stop] [--db-only] [--keep N]` | Encrypted backup — see [Backup & restore](/operations/backup) |
| `chinwag restore FILE` | Restore an encrypted backup |
| `chinwag doctor` | End-to-end health check of the installation |
| `chinwag setup-token` | Show the one-time setup token (before setup is completed) |
| `chinwag reset-password EMAIL` | Set a new password (prompted, or generated) and sign the user out everywhere |
| `chinwag unlock EMAIL` | Clear a login lockout |
| `chinwag admins` | List administrator accounts |
| `chinwag version` | Installed version |

Paths come from `/etc/chinwag/chinwag.conf`, written by the installer.
