# Backup and restoration

## What is backed up

| Item | Source |
|---|---|
| MySQL database (all application data and settings) | `mysqldump --single-transaction` |
| WhatsApp authentication sessions | `$DATA_DIR/sessions` (Chromium caches excluded) |
| Media files | `$DATA_DIR/media` |
| Environment configuration | `.env` |

Archives are encrypted with AES-256 (`openssl enc -aes-256-cbc -pbkdf2 -iter 600000`) using the passphrase in
`/root/.techtix-whatsapp-backup-passphrase` (generated on first run, mode 600), written with mode 600 to
`/var/backups/techtix-whatsapp/` with a SHA-256 checksum file. The newest 14 are kept.

> Store the backup passphrase **and** `APP_ENCRYPTION_KEY` (in `.env`, needed to decrypt stored webhook and
> OAuth client secrets) in a password manager, separately from the backup files.

## Running backups

```bash
sudo ./backup.sh --stop        # full + consistent: stops the app for the session copy (~seconds), then restarts
sudo ./backup.sh               # full while running (sessions may occasionally need a QR re-scan after restore)
sudo ./backup.sh --db-only     # database + .env only (used automatically by update.sh)
```

Example cron (`/etc/cron.d/techtix-whatsapp`):

```
30 3 * * *  root  /opt/techtix-whatsapp/backup.sh --stop --keep 14 >> /var/log/techtix-whatsapp/backup.log 2>&1
0  * * * *  root  /opt/techtix-whatsapp/backup.sh --db-only --keep 48 >> /var/log/techtix-whatsapp/backup.log 2>&1
```

Copy backups off-server (rsync, rclone to object storage). They are already encrypted.

## Restoring (same or new server)

1. Install the application on the target (`install.sh`), skipping the setup wizard.
2. Copy the backup, its `.sha256`, and the passphrase file to `/root/.techtix-whatsapp-backup-passphrase`.
3. **Stop the original server** (`pm2 stop techtix-whatsapp`) — two servers must never run the same
   WhatsApp session simultaneously.
4. Run:

```bash
sudo ./restore.sh /var/backups/techtix-whatsapp/techtix-whatsapp-20261124T033000Z.tar.gz.enc
```

The script verifies the checksum, asks for confirmation, restores `.env` (keeping the previous one),
the database, sessions and media, fixes ownership/permissions, applies migrations and starts PM2.
Options: `--no-db`, `--no-sessions`, `--no-env`.

5. Review `.env` (`BASE_URL`, `DATABASE_URL`, `CHROMIUM_PATH`) for the new host, update DNS, then check
   **WhatsApp Accounts**. Sessions that WhatsApp has invalidated show *Logged out* / *Authentication failed* —
   re-authenticate them by scanning a new QR code.
