# Backup & restore

## What is backed up

| Item | Source |
|---|---|
| Database (all data and settings) | `mysqldump --single-transaction` |
| WhatsApp sessions | `$DATA_DIR/sessions` (browser caches excluded) |
| Media | `$DATA_DIR/media` |
| Environment | `.env` |

Archives are encrypted with AES-256 (OpenSSL, PBKDF2 with 600,000 iterations) using the passphrase in `/root/.chinwag-backup-passphrase`, written with mode 600 to `/var/backups/chinwag/` with a SHA-256 checksum. The newest 14 are kept.

::: warning Keep two secrets off the server
The **backup passphrase** and the **`APP_ENCRYPTION_KEY`** in `.env`. Without them a backup cannot be restored (or its stored secrets decrypted).
:::

## Running backups

```bash
sudo chinwag backup --stop      # full and consistent: pauses Chinwag for a few seconds while copying sessions
sudo chinwag backup             # full, while running (a restored session may occasionally need a new QR scan)
sudo chinwag backup --db-only   # database and .env only (done automatically before every update)
```

Schedule it (`/etc/cron.d/chinwag`):

```
30 3 * * * root /usr/local/bin/chinwag backup --stop --keep 14 >> /var/log/chinwag/backup.log 2>&1
0  * * * * root /usr/local/bin/chinwag backup --db-only --keep 48 >> /var/log/chinwag/backup.log 2>&1
```

Copy backups off the server (rsync, rclone to object storage) — they're already encrypted.

## Restoring (same or new server)

1. Install Chinwag on the target server, but don't complete the setup wizard.
2. Copy the backup, its `.sha256` and the passphrase file (`/root/.chinwag-backup-passphrase`).
3. **Stop the original server.** Two servers must never run the same WhatsApp session at the same time.
4. Restore:

```bash
sudo chinwag restore /var/backups/chinwag/chinwag-20261124T033000Z.tar.gz.enc
```

The restore verifies the checksum, asks for confirmation, restores `.env` (keeping the previous one), the database, sessions and media, fixes permissions, applies migrations and starts Chinwag. Options: `--no-db`, `--no-sessions`, `--no-env`.

5. Check `BASE_URL`, `DATABASE_URL` and `CHROMIUM_PATH` in `.env` for the new server, update DNS, then review **WhatsApp Accounts** — re-scan any account WhatsApp has unlinked.
