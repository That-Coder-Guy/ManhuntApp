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

## Fly.io (cloud), as an alternative to the Pi
Added 2026-11-21, after the Pi's quick tunnel stalled on large files and then dropped (the landing page wouldn't load, and the old address went dead). `npm run deploy:fly -- --app <name>` (first time) or `npm run deploy:fly` (updates) puts the same single-origin app on one always-on Fly.io machine at `https://<name>.fly.dev`, an address that never changes. The pieces: `Dockerfile`, `.dockerignore`, `fly.toml`, `scripts/deploy-fly.mjs`. The README has the guide.

- **Live since 2026-11-21 at `https://manhunt.fly.dev`** (app `manhunt`, on the owner's personal Fly.io organisation, about $2 a month, no free plan). The first deploy worked as written and was checked from outside: one `shared-cpu-1x` 256 MB machine in `dfw`, health check passing, the landing page showing the deployed version, the script served compressed, sockets answering, both push keys set as secrets. The Pi's services weren't touched: whether to stop them is the owner's call.
- **One machine, always on.** Lobbies are in memory: `--ha=false` on deploy (Fly makes two by default) and `auto_stop_machines = "off"`, with `auto_start_machines = true` so that a machine that does get stopped comes back on the next visit.
- **Version without git.** The image has no checkout, so the script passes `MANHUNT_BUILD` / `MANHUNT_COMMIT` / `MANHUNT_COMMIT_DATE` as build arguments; `shared/version.js` falls back to them when git can't be read.
- **Push keys are Fly secrets** (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`), made once by the script. A new address means phones subscribe again anyway, so the Pi's keys aren't carried over.
- **Compression.** The server now compresses what it serves from `dist/` (the `compression` package): the 1.76 MB script goes out at about 430 KB. Behind Cloudflare the edge did this for phones, but the Pi still uploaded the full size; Fly's proxy isn't documented as compressing at all.
- **The native apps** have this address built in (since 2026-11-21): they no longer ask for one. See [[iOS app]] and [[Android app]].
- **The trial stops the machine after 5 minutes** until a payment card is on the Fly.io account (`fly logs` says "Trial machine stopping"; found 2026-11-21, minutes after the first deploy, when the site stopped answering). Adding the card is the owner's to do. A stopped machine used to stay stopped, because `auto_start_machines` was `false`; it's `true` now, so the next visit starts it again (after the next deploy). Start one by hand with `fly machine start <id> --app manhunt`.

## The address
It's a **quick tunnel** (`*.trycloudflare.com`): free, no domain, but a new address whenever the tunnel restarts (reboot, power cut, a changed port). Re-running the script with nothing changed keeps it. `--hostname manhunt.example.com` switches to a fixed address on your own Cloudflare domain. See [[Decisions]] for why it isn't on Vercel or workers.dev.

## Things kept on the Pi
- `server/.vapid-keys.json`: the key pair that signs [[Notifications]]. Made on first start, gitignored, **keep it**: phones' subscriptions belong to it. `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` override it.
- Other environment variables: `PORT` (3001), `ALLOWED_ORIGINS`, `TRUST_ALL_ORIGINS=1`, `VAPID_SUBJECT`.

## Checking an update landed
The landing page footer shows *Version N · commit · date*; the script prints the same at the end. If the phone's copy differs from the server's, the footer says so in red. See [[App updates and version]].
