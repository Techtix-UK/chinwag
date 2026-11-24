# Requirements

| | Minimum | Recommended |
|---|---|---|
| OS | Debian 12, Ubuntu 22.04 | Debian 13 / Ubuntu 24.04+ |
| CPU | 2 vCPU | 2–4 vCPU |
| Memory | 2 GB | 2 GB + ~300 MB per connected WhatsApp account |
| Disk | 5 GB | 20 GB+ (media grows with use) |
| Architecture | amd64 | amd64 (arm64 supported on Debian) |
| Network | Outbound HTTPS to `web.whatsapp.com` | A domain name pointing at the server for HTTPS |

The installer adds everything else: Node.js 22, a browser (Google Chrome on Ubuntu, Chromium on Debian), MariaDB, PM2 and optionally Caddy or Nginx.

**No Docker, Redis or paid services are required.** If a database server you don't want to touch is already running (for example inside another app), the installer can run Chinwag's database in a small Docker container instead, or use any MySQL 8 / MariaDB 10.6+ database you point it at.

## Phones

- Each WhatsApp account you link needs its phone online occasionally; WhatsApp unlinks devices after about 14 days offline.
- A phone can have up to four linked devices; Chinwag uses one.

## Shared hosting

Not supported. Chinwag needs root access, long-running processes and a headless browser, which shared hosting does not allow. A small VPS is enough.

## DirectAdmin / cPanel servers

Supported alongside existing sites, as long as you have root SSH. The installer will not modify your control panel's web server — use the [DirectAdmin proxy guide](/guide/reverse-proxy#directadmin).
