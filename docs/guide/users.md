# Users & permissions

Permissions are enforced by the server on every request — the dashboard only reflects them.

## Roles

| Role | Can |
|---|---|
| **Super Administrator** | Everything, on all accounts. |
| **Administrator** | Manage assigned accounts, conversations, integrations and users — never beyond their own access. |
| **Messaging Agent** | Read and reply on assigned accounts, contacts, scheduling. |
| **Read-only User** | View permitted conversations. |
| **Integration Client** | No dashboard; can authorise MCP clients within their granted access. |

## Per-account access

Except for Super Administrators, users get access per WhatsApp account: **Read**, **Read & send** or **Manage**. An agent with *Read* on an account cannot send from it, whatever their role.

## Sign-in security

Argon2id password hashing, session cookies that are HTTP-only and Secure, CSRF protection, idle and absolute session expiry, rate limiting and automatic lockout after repeated failures. Users can see and sign out their other sessions under **Profile & security**. Forgotten admin password? See [`chinwag reset-password`](/operations/cli).
