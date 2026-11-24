# WhatsApp accounts

Every account is an independent WhatsApp Web *linked device* with its own browser profile, stored under `/var/lib/chinwag/sessions/session-acc-<id>` (mode 700). Accounts never share sessions, contacts or messages.

## Adding an account

**WhatsApp Accounts → Add account**, name it, then scan the QR code from the phone (**Settings → Linked devices → Link a device**). Both personal and WhatsApp Business accounts work.

## Statuses

| Status | Meaning |
|---|---|
| Initialising | The browser is starting. |
| Awaiting QR scan | Scan the code shown; it refreshes automatically. |
| Authenticating | Scanned — WhatsApp Web is loading (usually under 2 minutes; longer for large histories). |
| Synchronising | Connected and copying recent chats into Chinwag. |
| Connected | Ready to send and receive. |
| Reconnecting | Recovering automatically after a failure (with back-off). |
| Disconnected | Stopped by an administrator — never reconnects by itself. |
| Error | Automatic recovery gave up after the configured number of attempts — use **Restart session**. |
| Auth failed / Logged out / Session expired | Use **Re-authenticate** to scan a new QR code. |

Sessions survive application and server restarts. If a session is authenticated but WhatsApp Web hasn't finished loading after 10 minutes, Chinwag restarts it (within the retry limit).

## Actions

**⋯ menu:** Rename · Diagnostics · Connect · Restart session · Disconnect · Re-authenticate (new QR) · Log out device · Remove account.

*Diagnostics* shows the session state, WhatsApp Web version, recovery attempts, last error, browser memory/CPU and how much data is stored for the account.

*Remove account* logs out and permanently deletes that account's conversations, contacts, media and scheduled messages.
