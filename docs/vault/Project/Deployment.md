---
tags: [manhunt, deployment]
---
# Deployment

Runs on a **Raspberry Pi** (any Linux box works) as two systemd services: `manhunt` (the Node server, serving the app and API) and `manhunt-tunnel` (a Cloudflare tunnel). `scripts/setup-server.sh` sets both up; the README has the full guide.

## Commands
```bash
# first time
git clone https://github.com/That-Coder-Guy/ManhuntApp.git ~/ManhuntApp
cd ~/ManhuntApp && scripts/setup-server.sh --quick

# update (between rounds: restarting ends live games)
cd ~/ManhuntApp && git pull && scripts/setup-server.sh

# where is it?
scripts/setup-server.sh --url
curl https://<address>/manhunt-api/health      # includes the version
systemctl status manhunt manhunt-tunnel
journalctl -u manhunt -f
```

## The address
It's a **quick tunnel** (`*.trycloudflare.com`): free, no domain, but a new address whenever the tunnel restarts (reboot, power cut, a changed port). Re-running the script with nothing changed keeps it. `--hostname manhunt.example.com` switches to a fixed address on your own Cloudflare domain. See [[Decisions]] for why it isn't on Vercel or workers.dev.

## Things kept on the Pi
- `server/.vapid-keys.json`: the key pair that signs [[Notifications]]. Made on first start, gitignored, **keep it**: phones' subscriptions belong to it. `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` override it.
- Other environment variables: `PORT` (3001), `ALLOWED_ORIGINS`, `TRUST_ALL_ORIGINS=1`, `VAPID_SUBJECT`.

## Checking an update landed
The landing page footer shows *Version N · commit · date*; the script prints the same at the end. If the phone's copy differs from the server's, the footer says so in red. See [[App updates and version]].
