# FAQ

**Is this the official WhatsApp Business API?**
No. Chinwag links your existing WhatsApp numbers as linked devices through WhatsApp Web, using the unofficial whatsapp-web.js library. No Meta developer account, templates or per-message fees — and no guarantees from Meta either.

**Will my number get banned?**
WhatsApp may restrict accounts it considers automated or spammy. Use Chinwag for normal, expected conversations — replying to customers, reminders people asked for — never bulk or unsolicited messaging.

**Does my phone have to stay on?**
It needs to come online periodically. WhatsApp unlinks devices that haven't connected for about 14 days.

**Can ChatGPT send messages without me?**
Only if you choose *Direct sending* for that connection. With *Confirm in ChatGPT* you approve each draft in the chat; with *Dashboard approval* a reviewer approves it in Chinwag.

**Where is my data?**
On your server: the database you chose and `/var/lib/chinwag`. Nothing is sent to Techtix.

**Can I run it in Docker?**
Not officially yet — the supported path is the installer on Debian/Ubuntu. (The installer can run just the database in Docker if another database server is already present.)

**How many accounts can one server handle?**
Roughly one per 300 MB of free RAM; set the limit under Settings → Maximum connected accounts.

**Why the name?**
A *chinwag* is British slang for a good chat.

**Licence?**
AGPL-3.0. You can self-host and modify it freely; if you offer a modified version as a hosted service, you must publish your changes.
