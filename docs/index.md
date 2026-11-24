---
layout: home
hero:
  name: Chinwag
  text: Your WhatsApp, on your server, ready for AI.
  tagline: A self-hosted team inbox, REST API and MCP server for WhatsApp — connect ChatGPT and your own apps to all of your WhatsApp numbers, with approvals, audit logs and per-account permissions.
  image:
    src: /logo.svg
    alt: Chinwag
  actions:
    - theme: brand
      text: Install in 10 minutes
      link: /guide/installation
    - theme: alt
      text: What is Chinwag?
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/Techtix-UK/chinwag
features:
  - icon: 📱
    title: Many numbers, one inbox
    details: Link personal and Business accounts by QR code. Each runs its own isolated WhatsApp Web session that survives restarts.
  - icon: 🤖
    title: ChatGPT & MCP built in
    details: A standards-based remote MCP server with OAuth 2.1. Ask ChatGPT to find a conversation, summarise customers or draft a reply.
  - icon: ✅
    title: You stay in control
    details: Confirm every message in ChatGPT, approve in the dashboard, or allow direct sending — per connection. Nothing is ever guessed.
  - icon: 🔌
    title: REST API & webhooks
    details: Scoped API keys, idempotent sends, OpenAPI docs, and HMAC-signed webhooks for every message and account event.
  - icon: 🗓️
    title: Scheduling that survives restarts
    details: Database-backed scheduled messages with timezones, expiry rules and no risky automatic retries.
  - icon: 🔐
    title: Secure by default
    details: Argon2id, CSRF protection, per-account roles, audit logs, encrypted backups, SSRF guards and a sandboxed browser.
---

<div class="vp-doc" style="max-width: 760px; margin: 48px auto 0; padding: 0 24px">

## Install

On a fresh Debian 12+ or Ubuntu 22.04+ server:

```bash
curl -fsSL https://raw.githubusercontent.com/Techtix-UK/chinwag/main/install.sh | sudo bash
```

The installer sets up Node.js, a browser, MariaDB, HTTPS (Caddy or Nginx + Let's Encrypt, or a Cloudflare Tunnel) and the `chinwag` management command, then prints your setup link. [Full installation guide →](/guide/installation)

::: warning Unofficial
Chinwag drives WhatsApp Web with the open-source [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) library. It is not affiliated with, endorsed by, or an official product of WhatsApp or Meta. WhatsApp may restrict accounts it considers automated — use Chinwag for conversations people expect, never for bulk or unsolicited messaging.
:::

</div>
