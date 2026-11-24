# Upgrading

```bash
sudo chinwag update
```

This takes a database backup, fetches the newest release (or `--ref` a specific tag/branch), installs dependencies, rebuilds, applies database migrations and restarts. WhatsApp sessions reconnect from their stored credentials — no QR scan needed. A failed health check after the restart is reported; your previous version is still in git (`sudo chinwag update --ref <previous tag>` to roll back code; restore the pre-update backup if a migration must be undone).

Release notes: [GitHub Releases](https://github.com/Techtix-UK/chinwag/releases).

## Upgrading from "Techtix WhatsApp"

Chinwag was previously released privately as *Techtix WhatsApp*. Existing installations in `/opt/techtix-whatsapp` keep working — the scripts detect the old paths, service user and PM2 name automatically. After pulling the renamed release once:

```bash
cd /opt/techtix-whatsapp
sudo -u techtix-whatsapp -H git pull
sudo bash scripts/update.sh
sudo ln -sf /opt/techtix-whatsapp/scripts/chinwag /usr/local/bin/chinwag
```

Notes for the rename:

- Dashboard users are signed out once (the session cookie is now `chinwag_session`).
- Webhook headers are now `X-Chinwag-*` instead of `X-Techtix-*` — update your receivers.
- New API keys start with `cwk_`; existing `ttw_` keys keep working.
