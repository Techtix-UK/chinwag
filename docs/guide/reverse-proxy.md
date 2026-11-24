# HTTPS & reverse proxy

Chinwag listens on `127.0.0.1:3100` only. Something in front of it must provide HTTPS. Whatever you use needs to:

- pass **WebSockets** on `/socket.io/` (live dashboard updates);
- **not buffer** `/mcp` (MCP over Streamable HTTP);
- allow request bodies of **at least 150 MB** (attachments);
- send `X-Forwarded-Proto: https` (keep `TRUST_PROXY=1` in `.env` for one proxy hop).

## Caddy (installer default)

The installer writes `/etc/caddy/sites/chinwag.caddy` and Caddy obtains and renews certificates automatically:

```txt
chat.example.com {
	encode zstd gzip
	request_body {
		max_size 150MB
	}
	@mcp path /mcp
	reverse_proxy @mcp 127.0.0.1:3100 {
		flush_interval -1
	}
	reverse_proxy 127.0.0.1:3100
}
```

## Nginx + Let's Encrypt

The installer writes `/etc/nginx/sites-available/chinwag.conf` from [`deploy/nginx/chinwag-http.conf`](https://github.com/Techtix-UK/chinwag/blob/main/deploy/nginx/chinwag-http.conf) and runs `certbot --nginx`. A complete HTTPS example is in [`deploy/nginx/chinwag-https.conf`](https://github.com/Techtix-UK/chinwag/blob/main/deploy/nginx/chinwag-https.conf).

## Apache

See [`deploy/apache/chinwag.conf`](https://github.com/Techtix-UK/chinwag/blob/main/deploy/apache/chinwag.conf). Required modules: `proxy proxy_http proxy_wstunnel headers rewrite ssl`. Put the `/mcp` `ProxyPass` (with `flushpackets=on`) **before** the catch-all `/`.

## Cloudflare Tunnel

No open ports and no certificates to manage — ideal if `cloudflared` already runs on the server.

- **Dashboard-managed tunnel:** *Zero Trust → Networks → Tunnels →* your tunnel *→ Public hostnames → Add*: subdomain + domain, type **HTTP**, URL `127.0.0.1:3100`.
- **Locally managed (`config.yml`):** add before the final `http_status:404` rule, then `cloudflared tunnel route dns <tunnel> chat.example.com` and restart `cloudflared`:

```yaml
  - hostname: chat.example.com
    service: http://127.0.0.1:3100
```

Cloudflare settings for this hostname:

- turn **Rocket Loader off** (it injects scripts the dashboard's Content-Security-Policy blocks);
- don't put **Cloudflare Access**, Bot Fight Mode or WAF challenges in front of `/mcp`, `/.well-known/*`, `/authorize`, `/token`, `/register`, `/revoke` or `/api/v1/*` — ChatGPT's servers and API clients can't solve challenges;
- no "Cache Everything" rules.

The free plan allows uploads up to 100 MB.

## DirectAdmin

The installer never edits DirectAdmin's web server. Instead:

1. Create the subdomain under **Domain Setup** and issue a Let's Encrypt certificate under **SSL Certificates** (tick *Force SSL*).
2. **Admin Level → Custom HTTPD Configurations →** your domain **→ httpd.conf** — paste [`deploy/apache/directadmin-custom-httpd.conf`](https://github.com/Techtix-UK/chinwag/blob/main/deploy/apache/directadmin-custom-httpd.conf). For Nginx or Nginx+Apache use [`deploy/nginx/directadmin-nginx-custom.conf`](https://github.com/Techtix-UK/chinwag/blob/main/deploy/nginx/directadmin-nginx-custom.conf) in the **nginx.conf** box.
3. Check `httpd -M | grep proxy_wstunnel` and `httpd -t`.

## Verify

```bash
curl -s https://chat.example.com/api/v1/health
curl -s https://chat.example.com/.well-known/oauth-protected-resource/mcp
chinwag doctor
```
