# Deploying to commanderstitch.com/dig

The game is a **long-running Node 22 process** that holds WebSocket connections and writes saves to disk. Plain static web hosting (only serving files) can't run it. You need somewhere that can keep `node server/index.js` running, and your web server for commanderstitch.com has to forward `/dig/` to it.

Settings (environment variables):

| Var | Value for production | Meaning |
|---|---|---|
| `BASE_PATH` | `/dig` | URL prefix the game lives under |
| `PORT` | `3000` | port the game listens on |
| `HOST` | `127.0.0.1` | listen only locally, behind the proxy |
| `DATA_DIR` | `/var/lib/dig` (or the Docker volume) | where saved ships go. **Back this up.** |

The server accepts requests with or without the `/dig` prefix, so it works whether your proxy passes the prefix through or strips it.

---

## Option A: commanderstitch.com runs on your own server/VPS (nginx or Apache)

### With Docker
```bash
git clone git@github.com:Dodgeandbounce/dig.git /opt/dig && cd /opt/dig
docker compose up -d --build          # listens on 127.0.0.1:3000, saves in the dig-data volume
```
Update later with `git pull && docker compose up -d --build`. Saves persist in the volume.

### Without Docker (systemd)
```bash
sudo useradd --system --home /opt/dig dig
sudo git clone https://github.com/Dodgeandbounce/dig.git /opt/dig
sudo mkdir -p /var/lib/dig && sudo chown dig:dig /var/lib/dig
sudo cp /opt/dig/deploy/dig.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dig
curl http://127.0.0.1:3000/dig/api/health     # {"ok":true,...}
```
Update later with `cd /opt/dig && sudo git pull && sudo systemctl restart dig`. Stopping the service saves every ship first.

### Then point the website at it
- **nginx:** paste `deploy/nginx.conf` into the commanderstitch.com `server {}` block, then `sudo nginx -t && sudo systemctl reload nginx`.
- **Apache:** `sudo a2enmod proxy proxy_http proxy_wstunnel`, paste `deploy/apache.conf` into the `<VirtualHost *:443>`, then `sudo apachectl configtest && sudo systemctl reload apache2`.

Open https://commanderstitch.com/dig. The header should say **online** in green.

## Option B: commanderstitch.com is shared or static hosting (no Node, no proxy config)

Run the game on a Node host that keeps a **persistent disk** (for example Fly.io with a volume, Railway with a volume, or a small VPS). Free tiers that sleep or wipe the disk will lose saved ships. Use the Dockerfile as-is (`BASE_PATH=/dig`, mount a volume at `/app/data`).

Then send visitors there in one of two ways:
1. **Subdomain (recommended):** add a DNS CNAME `dig.commanderstitch.com` pointing to the host. Set `BASE_PATH` to empty and play at https://dig.commanderstitch.com.
2. **Keep the /dig link:** upload a one-line `dig/index.html` to your static site that redirects to the game host, e.g.
   `<meta http-equiv="refresh" content="0; url=https://dig.commanderstitch.com/">`

A static host can't forward WebSockets, so serving the game from exactly `commanderstitch.com/dig` needs Option A (or a proxy/CDN such as Cloudflare in front of the domain).

---

## Checks after deploying
- `GET /dig/api/health` returns `{"ok":true}`.
- Two different browsers can see each other's ship in the lobby.
- Restart the service: ships are still there afterwards.
- HTTPS pages automatically use `wss://`. Mixed-content errors mean the proxy isn't forwarding WebSocket upgrades.
