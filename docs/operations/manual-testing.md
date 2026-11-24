# Manual test checklist

Automated tests mock whatsapp-web.js. These checks need real phones and must be performed (and recorded)
before go-live. Use test numbers that expect the messages.

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| 1 | QR pairing | Accounts → Add account → scan with WhatsApp → Linked devices | Status goes Awaiting QR → Authenticating → Synchronising → Connected; phone number and profile name shown; QR refreshes while waiting | ☐ |
| 2 | Receive message | Send a text from another phone | Appears in Inbox within seconds without refresh; unread badge increments; `message.received` webhook delivered | ☐ |
| 3 | Send message | Reply from the Inbox | Delivered on the phone; ticks progress sent → delivered → read | ☐ |
| 4 | Attachments out | Send image, PDF, video, audio from the composer | Received correctly with caption/filename | ☐ |
| 5 | Attachments in | Receive image, document, voice note, sticker, location | Rendered/playable; download works; files stored under `$DATA_DIR/media` | ☐ |
| 6 | Reply & react | Quote-reply and react to a message | Quoted context and reaction visible on the phone | ☐ |
| 7 | Groups | Open an existing group, read, send text and attachment | Sender names shown; participants listed; messages delivered | ☐ |
| 8 | Persistence | `pm2 restart chinwag` | Accounts reconnect without QR; no duplicate messages | ☐ |
| 9 | Server reboot | Reboot the VPS | PM2 starts the app; sessions reconnect | ☐ |
| 10 | Multiple accounts | Connect 2+ accounts; message each | Isolated inboxes, contacts and permissions | ☐ |
| 11 | Disconnect | Disconnect an account; restart the app | Stays disconnected (not auto-reconnected) | ☐ |
| 12 | Unlink from phone | Remove the linked device on the phone | Account shows Logged out; re-authenticate works | ☐ |
| 13 | Scheduled message | Schedule 2 min ahead; restart the app in between | Sent once at the right time in the selected timezone | ☐ |
| 14 | Scheduled while offline | Schedule, disconnect account past expiry | Marked Expired, not sent late | ☐ |
| 15 | Approvals | API key with "require approval" sends | 202 pending; nothing sent until approved; approve → delivered | ☐ |
| 16 | ChatGPT MCP | Connect connector via OAuth; "List my WhatsApp accounts"; "Show unread messages"; "Send … to …" | Correct data; send creates approval (default policy); revoke in dashboard stops access | ☐ |
| 17 | MCP search | "Search conversations for invoice INV-…" | Finds locally synchronised messages | ☐ |
| 18 | Webhooks | Configure receiver; Send test; receive a message | Signatures verify; retries visible on failure | ☐ |
| 19 | Backup/restore | `backup.sh --stop`, restore on a second server with the original stopped | App, settings and sessions restored (or clean re-auth if WhatsApp revoked them) | ☐ |
| 20 | Permissions | Agent with one account; read-only user | Cannot see other accounts or send respectively | ☐ |

Record date, tester, app version (`git rev-parse --short HEAD`), whatsapp-web.js version and WhatsApp Web version (Diagnostics).
