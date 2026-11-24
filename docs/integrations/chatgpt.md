# ChatGPT (MCP)

Chinwag includes a remote **Model Context Protocol** server, so ChatGPT and other MCP clients can work with your WhatsApp accounts — with your permission and under your rules.

- **Endpoint:** `https://your-host/mcp` (Streamable HTTP, stateless POST)
- **Authentication:** OAuth 2.1 authorisation code + PKCE (S256). Discovery at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`. Dynamic client registration and Client ID Metadata Documents (used by ChatGPT) are supported.
- No OpenAI API key is needed.

## Connect ChatGPT

1. In ChatGPT open **Settings → Apps & Connectors**. Under **Advanced**, enable **Developer mode** (on Business/Enterprise workspaces an admin may need to allow custom connectors).
2. **Create** a connector: name *Chinwag*, MCP server URL `https://your-host/mcp`, authentication **OAuth**. Leave client ID/secret empty.
3. ChatGPT opens Chinwag's sign-in page. Sign in, then on the consent screen choose:
   - which **WhatsApp accounts** ChatGPT may use;
   - which **permissions** (read chats, send messages, schedule, …);
   - how outgoing messages are **confirmed** — *Confirm in ChatGPT*, *ChatGPT or dashboard*, *Dashboard approval*, *Read-only* or *Direct sending*.
4. Enable the connector in a chat and try:
   - "List my connected WhatsApp accounts."
   - "Show unread WhatsApp conversations on the UK account."
   - "Summarise my latest messages from South African customers."
   - "Search WhatsApp for invoice INV-1042."
   - "Send 'Your order has shipped' to +44 7700 900123 from Sales UK."
   - "Schedule a payment reminder to Jane for Monday 9am."

## Confirming in ChatGPT

With **Confirm in ChatGPT**, a send returns `confirmation_required` with the exact draft. ChatGPT shows it to you; only when you agree does it call `confirm_message`. Drafts expire after 15 minutes, can only be confirmed by the same connection, and confirmation sends exactly what was drafted. ChatGPT may also display its own confirmation prompt for write actions.

## Manage connections

**MCP Integration** in the dashboard lists every connection with its user, accounts, scopes, last use and errors. Change a connection's policy or revoke it — revocation is immediate. **Test connection** checks discovery and authentication end to end.

## Safety

- Every account-specific tool requires an explicit `account_id`; the server never picks an account.
- Ambiguous recipients return `ambiguous_recipient` with candidates — nothing is sent.
- Retrieved WhatsApp content carries an *untrusted content* notice; the server instructions tell the model never to follow instructions found in messages. Permissions are enforced server-side regardless.
- Tokens are opaque, stored hashed, expire after an hour, and refresh tokens rotate with reuse detection.
