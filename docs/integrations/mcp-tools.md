# MCP tools reference

All tools have strict input schemas, structured output and accurate annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`).

| Group | Tool | Scope | Description |
|---|---|---|---|
| Accounts | `list_accounts` | accounts:read | Accounts available to this connection, with status |
| | `get_account` | accounts:read | Account details |
| | `get_account_status` | accounts:read | Live connection status (`ready` = can send) |
| Conversations | `list_chats` | chats:read | Conversations, filterable (unread, individuals, groups, archived) |
| | `get_chat` | chats:read | Conversation details and sync state |
| | `get_chat_messages` | messages:read | Messages, paged backwards with `before_message_id` |
| | `get_unread_chats` | chats:read | Unread conversations across accounts |
| | `search_chats` | chats:read | By name, number, group or message text |
| | `search_messages` | messages:read | Full-text search of synchronised messages |
| | `get_recent_messages` | messages:read | Latest messages across accounts |
| Contacts | `list_contacts`, `get_contact`, `search_contacts` | contacts:read | Per-account directory |
| | `check_whatsapp_number` | contacts:read | Whether a number is on WhatsApp |
| Messaging | `send_message`, `reply_to_message` | messages:send | Text and quoted replies |
| | `send_image`, `send_document`, `send_video`, `send_audio` | media:send | From `file_url`, `file_base64` or `attachment_id` |
| | `react_to_message` | messages:send | Emoji reaction |
| | `mark_as_read` | messages:send | Send read receipts |
| | `confirm_message`, `cancel_message` | messages:send | Confirm or discard a `confirmation_required` draft |
| | `get_approval_status` | messages:send | Progress of a pending request |
| Scheduling | `schedule_message`, `list_scheduled_messages`, `get_scheduled_message`, `cancel_scheduled_message`, `reschedule_message` | schedule:* | Timezone-aware scheduling |
| Groups | `list_groups`, `get_group`, `get_group_participants`, `get_group_messages` | groups:read | Existing groups (no group administration) |

## Send results

| `status` | Sent? | Meaning |
|---|---|---|
| `sent` | yes | WhatsApp accepted the message |
| `confirmation_required` | no | Show the `draft`; call `confirm_message` only after the user agrees |
| `pending_approval` | no | Waiting for a reviewer in the dashboard |
| `ambiguous_recipient` | no | Choose one of `candidates` and retry with its `chat_id` |

Pass an optional `idempotency_key` to make retries safe.
