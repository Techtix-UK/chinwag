# Known limitations

- **Unofficial library.** whatsapp-web.js automates WhatsApp Web. Updates to WhatsApp Web can break
  connection, sync or sending until the library is updated; WhatsApp may restrict or ban accounts it deems
  automated. This release depends on upstream commit `38eb45b` (merged 24 Nov 2026, after the 1.34.8 npm
  release) because WhatsApp Web moved logged-out sessions to a `/login/` page that 1.34.8 cannot handle.
  Switch back to an npm release once 1.34.9+ is published.
- **History.** Only messages WhatsApp Web has locally (or can load from the phone on request) can be
  synchronised. Chats are labelled full/partial; full means "everything WhatsApp Web returned", not a guarantee
  of the complete phone history.
- **Linked-device limits.** WhatsApp allows four linked devices per phone; sessions expire if the phone stays
  offline for ~14 days.
- **Message status.** Delivery/read receipts depend on the recipient's privacy settings; group read receipts
  aggregate. Edits/deletions are captured only while connected.
- **Media.** Downloads are buffered in memory by whatsapp-web.js; very large files are slow. Media older than
  WhatsApp's retention may be unavailable. Voice-note sending works best with OGG/Opus; stickers are received
  but not sent; location messages are received but not sent.
- **Archived / pinned** reflect WhatsApp Web state; changing them from the dashboard is not implemented.
- **Group management** (create, add/remove, promote) is out of scope for the MVP.
- **Contacts** are WhatsApp's own; LID-only (privacy) identifiers may lack phone numbers.
- **Single instance.** The session manager must run as exactly one process; horizontal scaling is not supported.
- **Encryption at rest** for session directories relies on filesystem/disk encryption (Chromium needs plaintext
  profiles while running).
- **MCP transport** is stateless Streamable HTTP (POST); server-initiated notifications are not offered.
- **i18n.** The interface is English only; the language setting affects date formatting defaults.
