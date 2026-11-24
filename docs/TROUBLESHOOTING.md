# Troubleshooting

| Symptom | Checks |
|---|---|
| Account stuck in *Initialising* / error "Waiting failed: 30000ms exceeded" | WhatsApp Web changed and the installed whatsapp-web.js cannot drive it. Check upstream issues; update whatsapp-web.js (`server/package.json`) and run `./update.sh`. This release pins upstream commit `38eb45b` which fixes the November 2026 `/login/` page change (#201988). |
| `Failed to launch the browser process` | `CHROMIUM_PATH` correct? `chromium --version` as the service user. Missing libraries → `apt-get install chromium`. Sandbox error ("No usable sandbox") → enable unprivileged user namespaces (DEPLOYMENT.md §1). |
| QR code never appears | System Health → Recent errors. Outbound HTTPS to `web.whatsapp.com` allowed? Restart the account session. |
| QR scanned but returns to *Awaiting QR* | Phone offline or linked-device limit reached (4). Remove an old linked device in WhatsApp. |
| *Logged out* after restart | The device was unlinked on the phone or WhatsApp revoked the session. Re-authenticate (new QR). |
| *Error — automatic recovery stopped* | Retry limit reached (Settings). Read Diagnostics → last error; fix the cause, then **Restart session**. |
| Messages missing from history | Only what WhatsApp Web holds can be synchronised. Use **Load older from WhatsApp** in the chat or raise the initial sync limits. Chats show full / partial status. |
| Media shows "Not downloaded" | Auto-download disabled, file larger than the limit, or downloaded from an older session. Click to fetch; WhatsApp may have expired very old media. |
| Live updates not arriving | Reverse proxy must forward WebSockets on `/socket.io/` (Upgrade/Connection headers). The header shows "Live updates reconnecting…" when the socket is down. |
| ChatGPT cannot connect | `/.well-known/oauth-protected-resource/mcp` reachable over valid HTTPS? Dynamic client registration enabled (Settings)? `BASE_URL` must equal the public URL exactly. Use **MCP Integration → Test connection**. |
| MCP responses stall | Proxy buffering on `/mcp` must be off (see proxy examples). |
| `invalid_grant` after a while | Refresh token reuse was detected (e.g. two clients sharing one connection) and the grant was revoked — reconnect the client. |
| 413 on upload | Raise the proxy body limit and Settings → Maximum attachment size. |
| Webhook "destination rejected" | Private/loopback addresses are blocked. Use a public HTTPS endpoint or add the CIDR to `WEBHOOK_ALLOWED_PRIVATE_CIDRS`. |
| Scheduled message *Delivery uncertain* | The process stopped or WhatsApp errored mid-send. It is never retried automatically — check the chat and resend manually if needed. |
| Scheduled message *Expired* | The account was disconnected longer than *Scheduled message expiry* after the due time. |
| Setup wizard says "Invalid setup token" | Use `SETUP_TOKEN` from `.env` or `$DATA_DIR/setup-token`. After completion the wizard is disabled. |
| Locked out of the only admin account | Wait for the lockout window, or as root: `mysql -e "UPDATE users SET locked_until=NULL, failed_login_count=0 WHERE email='…'" <db>`. |
| High memory | Each account runs Chromium (~250–400 MB). Lower *Maximum connected accounts* or add RAM. |

Logs: `sudo -u techtix-whatsapp pm2 logs techtix-whatsapp` and `/var/log/techtix-whatsapp/`.
Set `LOG_LEVEL=debug` in `.env` and restart for detail (no secrets or message bodies are logged).
