# Security model

## Authentication
- Dashboard: email + password, **Argon2id** (m=19 MiB, t=2, p=1). Opaque 256-bit session tokens in an
  `HttpOnly`, `SameSite=Lax` (and `Secure` under HTTPS) cookie; only SHA-256 hashes are stored. Absolute and
  idle expiry (Settings). Password changes and deactivation revoke sessions.
- Brute force: per-IP login rate limit (20 / 15 min) plus per-account lockout after N failures; timing is
  equalised for unknown users.
- CSRF: per-session token required in `X-CSRF-Token` for cookie-authenticated writes, plus Origin checks.
- API keys: `ttw_` prefix + 256-bit secret, SHA-256 hashed, scoped, account-restricted, expiry, rotation, revocation.
- MCP: OAuth 2.1 via the official MCP SDK auth router — PKCE S256 only, exact redirect URI matching, consent
  screen, scopes and account grants, hashed opaque tokens, refresh rotation with reuse detection (revokes the grant),
  code replay protection, RFC 8707 resource checks, immediate revocation.

## Authorisation
- Permissions are enforced on the server for every request (REST, MCP, Socket.IO rooms). The UI only mirrors them.
- Two layers: role capabilities (Super Administrator, Administrator, Messaging Agent, Read-only, Integration
  Client) and per-account access (READ / SEND / MANAGE). Administrators cannot grant more than they hold or
  create super administrators.
- Integrations get the intersection of their grant and (for OAuth) the authorising user's current access.
- QR codes are only available to dashboard users with MANAGE on the account — never to API keys or MCP.

## Outbound safety
- Approval policies (read-only / require approval / direct) per API key and MCP connection; default require approval.
- Approvals bind to a SHA-256 hash of the canonical payload including the attachment checksum; any change
  supersedes the approval.
- No guessing of accounts or recipients; ambiguous names return candidates.
- Idempotency keys; uncertain deliveries are never retried automatically.
- WhatsApp content is labelled untrusted in MCP responses and server instructions.

## Data protection
- Sessions: `$DATA_DIR` and each session directory are `0700`, owned by the service user; in production the app
  refuses to start as root. Treat session directories as
  credentials. Chromium profiles must be readable by Chromium while running, so **at-rest encryption should be
  provided by the filesystem** (LUKS/dm-crypt volume or an encrypted VPS disk) for `/var/lib/techtix-whatsapp`.
- Backups: AES-256 encrypted archives (see BACKUP.md).
- Credential encryption: webhook signing secrets and OAuth client secrets are AES-256-GCM encrypted with
  `APP_ENCRYPTION_KEY`; passwords, API keys and tokens are only stored as hashes.
- Media: private directory outside the web root; authenticated download with account checks, content-type
  allow-list via magic bytes (HTML/SVG/executables rejected), `nosniff`, sandbox CSP, forced download for
  non-media types, size limits, safe filenames, retention.
- SSRF: webhook and attachment URL fetches resolve DNS, block loopback/private/link-local/CGNAT/multicast/
  metadata ranges (IPv4 + IPv6, incl. IPv4-mapped), pin the validated IP, re-validate redirects, cap size/time.
  Private destinations can only be allowed through `WEBHOOK_ALLOWED_PRIVATE_CIDRS` in the environment.
- Logs: audit metadata is scrubbed of passwords, tokens, secrets, QR data, session data and message content.

## Transport and headers
Helmet: strict CSP (`default-src 'self'`, no inline scripts), HSTS under HTTPS, `frame-ancestors 'none'`,
`nosniff`, `Referrer-Policy: same-origin`, Permissions-Policy. HTTPS enforcement when `BASE_URL` is https.
The server binds to `127.0.0.1`.

## Process isolation
Node.js and Chromium run as the non-root `techtix-whatsapp` user. Chromium's sandbox stays enabled unless
`CHROMIUM_DISABLE_SANDBOX=true` is set explicitly. One account's failure never stops other sessions; automatic
recovery is bounded (exponential back-off, retry limit), and Chromium start-ups are limited by
`CHROMIUM_START_CONCURRENCY`.

## Out of scope by design
No anti-detection measures, no bulk/unsolicited messaging features, no automated account creation, no group
administration actions, no circumvention of WhatsApp restrictions.
