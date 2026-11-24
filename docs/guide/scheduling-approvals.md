# Scheduling & approvals

## Scheduled messages

Schedule from the composer (calendar icon), from **Scheduled Messages**, through the API or by asking ChatGPT.

- Times are entered in your timezone and stored in UTC.
- Scheduled messages live in the database and survive restarts.
- If the account is disconnected when a message is due, Chinwag waits; if it's still disconnected after the **scheduled message expiry** (Settings), the message is marked **Expired** rather than sent late.
- A message that was mid-send when the process stopped is marked **Delivery uncertain** and is **never retried automatically** — check the chat before resending.
- Pending messages can be edited, rescheduled or cancelled.

| Status | Meaning |
|---|---|
| Pending | Will be sent at the scheduled time. |
| Awaiting approval | Requested by an integration; waiting for confirmation/approval. |
| Processing | Being sent now. |
| Sent / Failed / Cancelled / Expired / Delivery uncertain | Final states. |

## Approval policies

Every API key and MCP connection has a policy for outgoing messages:

| Policy | Behaviour |
|---|---|
| **Confirm in ChatGPT** | The AI shows you the exact draft (account, recipient, number, content); it's sent only after you confirm in the chat. Drafts expire after 15 minutes. *(MCP connections only.)* |
| **Confirm in ChatGPT or dashboard** | As above, and reviewers can also approve it in **Message Approvals**. *(MCP only.)* |
| **Dashboard approval** | Every send waits in **Message Approvals** for a reviewer. |
| **Read-only** | Cannot send anything. |
| **Direct sending** | Sent immediately. Only users with *integrations:manage* can grant it. |

Approvals apply to the **exact** content and recipient (bound by a hash of the payload, including the attachment's checksum). Any change creates a new request. A message waiting for approval is never reported as sent.
