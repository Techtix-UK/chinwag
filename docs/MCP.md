# MCP server and ChatGPT

- **Endpoint:** `https://whatsapp.techtixglobal.com/mcp` — Streamable HTTP, stateless (POST only).
- **Auth:** OAuth 2.1 authorization code + PKCE (S256). Discovery via
  `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`.
  Dynamic client registration (`/register`) and Client ID Metadata Documents are supported.
  API keys (`Bearer ttw_…`) are also accepted for server-to-server MCP clients and testing.
- **No OpenAI API key is needed.**

## Connect ChatGPT

1. In ChatGPT open **Settings → Apps & Connectors** (enable developer mode for custom connectors if your
   plan requires it) and create a new connector.
2. MCP server URL: `https://whatsapp.techtixglobal.com/mcp`; authentication: **OAuth**.
3. ChatGPT registers itself and opens the Techtix WhatsApp sign-in page. Sign in, then on the consent screen
   choose the WhatsApp accounts, permissions (scopes) and the outbound message policy:
   - **Require approval** (default) — sends create approval requests in **Message Approvals**;
   - **Read-only** — no sending;
   - **Direct sending** — only grantable by users with *integrations:manage*.
4. Try: *"List my connected WhatsApp accounts."*

Administrators see every connection under **MCP Integration**, can change its policy or accounts, and revoke it
immediately (all access and refresh tokens stop working). **Test connection** checks metadata and the 401 challenge.

## Scopes

`accounts:read chats:read messages:read messages:send contacts:read groups:read media:read media:send schedule:read schedule:write`

Effective access is always the intersection of the granted scopes/accounts and the consenting user's
current permissions — removing a user's access narrows their integrations immediately.

## Tools

| Group | Tools |
|---|---|
| Accounts | `list_accounts`, `get_account`, `get_account_status` |
| Conversations | `list_chats`, `get_chat`, `get_chat_messages`, `get_unread_chats`, `search_chats`, `search_messages`, `get_recent_messages` |
| Contacts | `list_contacts`, `get_contact`, `search_contacts`, `check_whatsapp_number` |
| Messaging | `send_message`, `reply_to_message`, `send_image`, `send_document`, `send_video`, `send_audio`, `mark_as_read`, `react_to_message`, `get_approval_status` |
| Scheduling | `schedule_message`, `list_scheduled_messages`, `get_scheduled_message`, `cancel_scheduled_message`, `reschedule_message` |
| Groups | `list_groups`, `get_group`, `get_group_participants`, `get_group_messages` |

Behaviour guarantees:

- Every account-specific tool requires `account_id`; the server never picks an account.
- Recipients: `chat_id`, `phone_number` (validated on WhatsApp), `contact_id`, or an exact `name`.
  Ambiguous names return `status: "ambiguous_recipient"` with `candidates` and nothing is sent.
- `status: "pending_approval"` / `sent: false` means **not sent**. `get_approval_status` reports progress.
- Optional `idempotency_key` prevents duplicate sends on retries.
- Retrieved content carries `untrusted_content_notice`; server instructions tell the model to treat
  WhatsApp content as data, never instructions. Permissions are enforced server-side regardless.
- Read-only tools are annotated `readOnlyHint: true`; sending tools `readOnlyHint: false, openWorldHint: true`;
  `cancel_scheduled_message` is `destructiveHint: true`.
- Media tools accept `file_url` (downloaded with SSRF protection and size limits), `file_base64` or an uploaded `attachment_id`.

## Token lifetimes

Access tokens 1 hour; refresh tokens 30 days, rotated on every use. Re-use of a refresh token or an
authorization code revokes the whole grant. Tokens are stored as SHA-256 hashes.
