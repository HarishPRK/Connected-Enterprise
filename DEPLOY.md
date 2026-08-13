# Deploying Connected Enterprise to AWS EC2

End-to-end guide to get the app live on an EC2 instance over **HTTP**. Estimated time: **~20 min**.

Architecture:

```
  user → http://<EC2-PUBLIC-DNS>:80 → Node 20 single process
                                       ├── /api/*  → Bedrock agent SSE
                                       └── /*      → Vite-built SPA
```

> **HTTPS later:** see the optional appendix at the bottom — register a domain, point it via Cloudflare, and add TLS. This guide stays HTTP-only for the first deploy.

---

## 0 · Prerequisites

- AWS account with billing enabled
- Your AWS Bedrock API key (starts with `bedrock-api-key-...`)
- SSH client (built into macOS/Linux; on Windows use PowerShell's `ssh`)

---

## 1 · Launch an EC2 instance

1. Sign in to [console.aws.amazon.com](https://console.aws.amazon.com) → switch region to `us-east-1` (or wherever your Bedrock API key region is — those two should match).
2. Go to **EC2 → Launch Instance**.
3. Fill in:
   - **Name:** `connected-enterprise`
   - **OS image:** *Ubuntu Server 22.04 LTS (HVM), SSD Volume Type · 64-bit (x86)*
   - **Instance type:** `t3.small` (2 GB RAM, ~$15/mo) — `t2.micro` is free-tier-eligible but tight on memory for Node + `tsx`
   - **Key pair:** create new (`connected-enterprise-key`) and download the `.pem` file — **save it somewhere safe**
   - **Network settings → Edit → Create security group:**
     - SSH (port 22) from **My IP**
     - HTTP (port 80) from **Anywhere** (`0.0.0.0/0`)
   - **Storage:** 16 GiB gp3
4. Click **Launch instance**. Wait ~30 s for state = *running*.

### Attach an Elastic IP (so the public DNS hostname doesn't change on reboot)

1. **EC2 → Elastic IPs → Allocate Elastic IP address → Allocate.**
2. Select the new IP → **Actions → Associate Elastic IP address → choose your instance → Associate.**
3. Note the **Public IPv4 DNS** of your instance (looks like `ec2-52-91-123-45.compute-1.amazonaws.com`). That's the URL you'll share.

---

## 2 · Set up the server

### 2.1 · SSH in

```bash
chmod 400 ~/Downloads/connected-enterprise-key.pem
ssh -i ~/Downloads/connected-enterprise-key.pem ubuntu@<ELASTIC-IP>
```

Windows PowerShell:

```powershell
ssh -i $HOME\Downloads\connected-enterprise-key.pem ubuntu@<ELASTIC-IP>
```

### 2.2 · Install Node 20, git, pm2

```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs git
sudo npm install -g pm2
node -v   # expect v20.x
```

### 2.3 · Let Node bind to port 80 without root

```bash
sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))
```

> This grants the `node` binary the single privilege of binding to ports below 1024. The actual process still runs as `ubuntu` (not root).

### 2.4 · Clone, install, build

```bash
cd ~
git clone <YOUR-REPO-URL> connected-enterprise
cd connected-enterprise
npm ci
npm run build
```

> If your repo is private: set up [GitHub deploy keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) first or use a personal access token in the clone URL (`https://<TOKEN>@github.com/...`).

### 2.5 · Create `.env`

```bash
cat > .env <<'EOF'
PORT=80
LLM_PROVIDER=bedrock
AWS_REGION=us-east-1
AWS_BEARER_TOKEN_BEDROCK=bedrock-api-key-PASTE-YOURS-HERE
AGENT_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0
IOT_IPSEC_TOPICS=rdk/ipsec/metrics,prpl/ipsec/metrics,prplhome/ipsec/metrics
IOT_IPSEC_DEVICE_TOPICS=rdk/ipsec/metrics,prplhome/ipsec/metrics
EOF

chmod 600 .env
```

### 2.6 · Start with PM2

```bash
pm2 start npm --name connected-enterprise -- run start
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu      # then copy/paste the line it prints
```

Verify the process is healthy:

```bash
pm2 logs connected-enterprise --lines 50
# expect:
# [ce-server] listening on http://0.0.0.0:80 · static=yes (dist/)
# [ce-server] provider=bedrock authMode=bedrock-api-key model=us.anthropic.claude-haiku-4-5-... ✓
```

Test the API locally on the box:

```bash
curl -i http://localhost/api/health
# expect: HTTP/1.1 200 OK with JSON body { ok: true, provider: "bedrock", ... }
```

---

## 3 · Open it in your browser

From any machine:

```
http://<ELASTIC-IP>
http://ec2-52-91-123-45.compute-1.amazonaws.com
```

(Either one works — same instance.)

You should see the dashboard load. The browser will show **"Not secure"** in the address bar — that's expected for HTTP-only. Some browser features (clipboard API, geolocation, etc.) won't work over plain HTTP, but the dashboard itself runs fine.

---

## 4 · Day-2 operations

### Deploy a new version

```bash
ssh ubuntu@<ELASTIC-IP>
cd ~/connected-enterprise
git pull
npm ci             # only if package.json changed
npm run build
pm2 restart connected-enterprise
```

### Inspect logs

```bash
pm2 logs connected-enterprise --lines 200
pm2 monit                    # live dashboard
```

### Update the Bedrock key

```bash
cd ~/connected-enterprise
nano .env                    # edit AWS_BEARER_TOKEN_BEDROCK
pm2 restart connected-enterprise
```

### Check the server's view of itself

```bash
curl -s http://localhost/api/health | jq .
```

---

## Costs (rough monthly)

| Item | Cost |
|---|---|
| EC2 `t3.small` (always-on) | ~$15 |
| Elastic IP (attached) | $0 (only billed if unattached) |
| EBS 16 GiB gp3 | ~$1.30 |
| Bandwidth out (~10 GB) | ~$0.90 |
| Bedrock token usage | pay-as-you-go |
| **Total** | **~$17 / mo** + Bedrock usage |

You can shave ~$10/mo by switching to a `t4g.small` ARM instance (`arm64` Node setup line instead of `x86`).

To stop the meter when you're not demoing: **EC2 → your instance → Instance state → Stop**. You won't be billed for the compute. The Elastic IP gets a small "unattached" fee (~$3.60/mo) — release it if you'll be off for a long time.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Error: listen EACCES :80` | Node can't bind to port 80 | Re-run `sudo setcap` from §2.3, then `pm2 restart` |
| Page loads but `/api/agent/run` returns 503 | Bedrock not configured | `pm2 logs` → look at the `[ce-server] provider=…` line; fix `.env`, `pm2 restart` |
| Can connect from the EC2 itself but not from your laptop | Security group blocking | EC2 → Security Groups → make sure port 80 is open to `0.0.0.0/0` |
| Page loads but routes like `/security` 404 on refresh | SPA fallback not working | Make sure `npm run build` ran and `dist/index.html` exists; restart pm2 |
| SSE / live agent stream cuts after 60 s | Heartbeat may have stopped | The server already sends a `: hb` heartbeat every 15s; check `pm2 logs` for errors |
| Hostname suddenly changed | Forgot Elastic IP | Public DNS changes on stop/start without an Elastic IP. Attach one (§1) |

---

## Appendix — adding HTTPS later

When you're ready to upgrade:

1. **Buy a domain** (Cloudflare Registrar ~$10/yr is the cheapest legitimate option).
2. **Cloudflare DNS** → add `A` record `app.yourdomain.com` → your EC2 Elastic IP, **proxy on (orange cloud)**.
3. **Cloudflare SSL/TLS → Overview → set mode = Flexible.** That's it — `https://app.yourdomain.com` works with a green padlock, Cloudflare handles TLS.
4. Optionally restrict the EC2 security group's port 80 to only [Cloudflare IP ranges](https://www.cloudflare.com/ips-v4) so the EC2 isn't directly reachable on the public internet.
5. To go end-to-end encrypted (Cloudflare ↔ EC2 also HTTPS), install certbot + Let's Encrypt on the box and switch Cloudflare to **Full (strict)**.

Note: Let's Encrypt **refuses to issue** certificates for `*.compute.amazonaws.com` hostnames — you need your own domain to enable HTTPS.
