# First-run setup

When the installer finishes, open the link it printed — `https://your-host/setup` — and enter the **setup token** (`chinwag setup-token` shows it again).

The wizard:

1. **Checks** the environment, database connection, migrations and browser. Everything should be green; Chinwag can apply pending migrations for you.
2. **Creates the first Super Administrator.** There are no default accounts or passwords. Use 12+ characters with three of: lower case, upper case, digits, symbols.
3. **Sets the public URL and default timezone.** Times are stored in UTC and shown in each user's timezone.
4. **Sets security defaults:** session lifetime, login lockout, the default approval policy for new integrations, and whether MCP clients such as ChatGPT may register themselves (needed for ChatGPT).
5. **Finishes** — you're signed in, and the wizard is disabled permanently.

## Link your first WhatsApp account

1. Go to **WhatsApp Accounts → Add account** and give it a name (for example "Sales UK").
2. On the phone: **WhatsApp → Settings → Linked devices → Link a device**, and scan the QR code. It refreshes automatically.
3. The status moves through *Authenticating* → *Synchronising* → **Connected**. Recent chats are synchronised (limits are configurable in **Settings**).

Next: [connect ChatGPT](/integrations/chatgpt), [invite your team](/guide/users) or [create an API key](/integrations/rest-api).
