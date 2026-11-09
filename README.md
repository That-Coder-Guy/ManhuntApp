# Manhunt

Real-world hide and seek. Players join a lobby on their phones, share live GPS
positions, and seekers get distance readouts and a compass arrow pointing at
their chosen hider.

Built to keep working on **spotty internet**: the client and server talk over
Socket.IO with automatic reconnection, players who drop offline keep their
identity for 5 minutes and resume seamlessly, stale positions are labeled
instead of silently shown as live, and a service worker keeps the app shell
loading without connectivity.

<p align="center">
  <img src="docs/walkthrough/hero.png" alt="Three phones running Manhunt: the pregame lobby, a seeker's compass pointing at a hider 166 m away, and a hider's list warning that a seeker is 52 m away" width="900">
</p>

## Walkthrough

One round, start to finish, as five friends play it. Every screen below is the
real app, captured at phone size (390 × 844) from a scripted game.

### 1. Start a lobby

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/walkthrough/01-home.png" alt="Home screen with Start a game and Join a game cards" width="100%"></td>
    <td width="33%" valign="top"><img src="docs/walkthrough/02-permissions.png" alt="Before you play dialog asking for location and keep-screen-on" width="100%"></td>
    <td width="33%" valign="top"><img src="docs/walkthrough/06-invite.png" alt="Invite sheet with a QR code and a Copy link button" width="100%"></td>
  </tr>
  <tr>
    <td valign="top"><b>Create or join.</b> Name the lobby and tap <i>Create lobby</i>. Friends join with the lobby ID, a pasted invite link, or the QR button, which scans an invite with the camera.</td>
    <td valign="top"><b>One permission.</b> Location is required; keeping the screen on is optional and never blocks you.</td>
    <td valign="top"><b>Invite.</b> The QR button in the top bar shows a code anyone can scan with their phone camera to land straight in the lobby.</td>
  </tr>
</table>

### 2. Gather in the lobby

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/walkthrough/03-lobby-host.png" alt="Pregame lobby seen by the host, with a Start game button" width="100%"></td>
    <td width="33%" valign="top"><img src="docs/walkthrough/05-lobby-guest.png" alt="Pregame lobby seen by a guest, waiting for the host" width="100%"></td>
    <td width="33%" valign="top"><img src="docs/walkthrough/07-player-menu.png" alt="Host's menu for a player: make a seeker, make host, remove from lobby" width="100%"></td>
  </tr>
  <tr>
    <td valign="top"><b>Everyone sets up.</b> A name, a small profile picture (tap the circle) and a role. The green dot means a player is connected. Only the host gets <i>Start game</i>, and only once there is a seeker and a hider.</td>
    <td valign="top"><b>Guests wait for the host.</b> They see the same rules and players, read-only.</td>
    <td valign="top"><b>The host is in charge.</b> The ••• menu on any player switches their role, hands over the host role, or removes them. The server enforces it, not just the app.</td>
  </tr>
</table>

### 3. Set the rules

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/walkthrough/04-play-area.png" alt="Game settings sheet with a six-corner play area drawn on a map, a 30 minute time limit and a 30 second head start" width="100%"></td>
    <td valign="top">
      <b>Draw the play area.</b> The host taps the map to place corners. Drag a corner to move it, tap it to remove it, or tap a hollow handle to add one between two corners. The area updates live, and a shape whose edges cross can't be saved.
      <br><br>
      <b>Time limit and head start.</b> Seekers wait out the head start while hiders' positions stay hidden. The clock starts when seekers set off; the hiders win if it runs out.
      <br><br>
      Everyone else can open the same sheet to see the rules and the area, but can't change them.
    </td>
  </tr>
</table>

### 4. Seek

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/walkthrough/08-head-start.png" alt="Seeker during the head start: Hiders are hiding 0:26, distances hidden" width="100%"></td>
    <td width="33%" valign="top"><img src="docs/walkthrough/09-seeker.png" alt="Seeker's list of hiders with distances; one hider marked Outside" width="100%"></td>
    <td width="33%" valign="top"><img src="docs/walkthrough/10-compass.png" alt="Compass dial with the needle pointing at Priya, 166 m away" width="100%"></td>
  </tr>
  <tr>
    <td valign="top"><b>Head start.</b> Seekers count down while hiders scatter. Hider positions are withheld by the server until it ends.</td>
    <td valign="top"><b>The hunt.</b> Every hider with their distance and how fresh their position is. Anyone who leaves the play area is marked <i>Outside</i>.</td>
    <td valign="top"><b>The compass.</b> Tap a hider: the needle points at them, the dial turns so N stays north, and the distance updates as you move.</td>
  </tr>
</table>

### 5. Hide

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/walkthrough/11-hider.png" alt="Hider's list of seekers; the closest is flagged at 52 m with a warning icon and a full red proximity bar" width="100%"></td>
    <td width="33%" valign="top"><img src="docs/walkthrough/12-outside.png" alt="Hider outside the play area: Outside, 251 m back, head N" width="100%"></td>
    <td width="33%" valign="top"><img src="docs/walkthrough/13-area-map.png" alt="Map of the play area with the player's position outside it" width="100%"></td>
  </tr>
  <tr>
    <td valign="top"><b>Watch them close in.</b> Seekers sorted by distance, with a bar that fills as each one gets closer. Under 100 m it turns red with a warning icon.</td>
    <td valign="top"><b>Stay in bounds.</b> Step outside the area and the status card says how far back it is and which way to go.</td>
    <td valign="top"><b>See the area.</b> Tap the status card to open the map, framed to show both the area and you.</td>
  </tr>
</table>

### 6. Weak signal, and the end of the round

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/walkthrough/14-offline.png" alt="Offline banner: positions from 6 s ago, with the list still showing" width="100%"></td>
    <td width="33%" valign="top"><img src="docs/walkthrough/15-game-over.png" alt="Game over screen with a Back to the lobby button for the host" width="100%"></td>
    <td valign="top">
      <b>Built for patchy signal.</b> When the connection drops, the game keeps showing the last known positions with their age, reconnects on its own and resumes the same player. Nobody is kicked out by a dead zone.
      <br><br>
      <b>Game over.</b> The round ends when time runs out or the host ends it. The host takes everyone back to the lobby for another round with the same group.
    </td>
  </tr>
</table>

<sub>The map imagery in these screenshots is a generated stand-in; the app shows
OpenStreetMap streets. To refresh the images after a UI change, run
`npm run screenshots` (see <a href="#regenerating-the-walkthrough-screenshots">below</a>).</sub>

## Repo layout

- Repo root — React + Vite frontend (this used to be the whole repo)
- `server/` — Express + Socket.IO backend (merged in from the old ManhuntApi repo)
- `shared/` — code both sides use (play-area geometry, server-address checks)
- `api/` — the one Vercel function: where the game server is right now

## Development

```bash
npm install                  # frontend deps
npm --prefix server install  # backend deps

npm run dev:server           # API + socket server on http://localhost:3001
npm run dev                  # Vite dev server (points at localhost:3001 via .env.development)

npm test                     # unit tests + socket-level server tests (needs the backend deps)
npm run lint
```

## How the protocol works

- `POST /manhunt-api/create-lobby` — the only REST endpoint; returns a `lobby_id`.
- Everything else happens over one Socket.IO connection (path
  `/manhunt-api/socket.io`), authenticated with `{ lobby_id, player_token }`:
  - No token → the server creates a player and returns a token in the `joined`
    event. The client stores it in localStorage.
  - Valid token → the server **resumes** that player (name, role, player_id
    preserved). This is what makes dead zones survivable: reconnecting after
    a dropout restores the same identity.
  - Client → server: `update-location`, `update-player`, `leave-lobby` (all acked).
  - Server → clients: `lobby-state` pushed to the lobby room on any change,
    throttled to 1/second per lobby. Includes each player's
    `location_last_updated` and `connected` flag so clients can show staleness.
- A player who disconnects is marked offline (not deleted) and kept for
  **5 minutes** before removal. After that, their token is rejected and the
  client offers the rejoin flow.

## Deployment

Two options:

1. **Single origin (simplest):** `npm run build`, then run `server/server.js`
   — it serves `dist/` itself when it exists. Build with `VITE_API_ORIGIN=""`
   (empty) so the client talks to its own origin.
2. **Split hosting:** host `dist/` anywhere, build with
   `VITE_API_ORIGIN=https://your-api-host`, and set the `ALLOWED_ORIGINS`
   env var (comma-separated) to your frontend origin. With
   `VITE_API_ORIGIN=auto` the app asks `/api/server-origin` for the address
   instead; that's how the [Vercel setup](#frontend-on-vercel-server-through-cloudflare)
   follows a changing tunnel address.

Notes:
- Any reverse proxy in front of the server must forward WebSocket upgrade
  headers for `/manhunt-api/socket.io`. If it can't, Socket.IO automatically
  falls back to HTTP long-polling.
- Lobby state is in-memory only: restarting the server ends all live games.

## Frontend on Vercel, server through Cloudflare

Vercel can host the frontend for free, but not the game server: the server
keeps a WebSocket open to every phone and holds lobbies in memory, which
Vercel's short-lived functions can't do. So the site goes on Vercel and the
server runs on an always-on machine, such as a Raspberry Pi, reached through
a free Cloudflare quick tunnel. Players only ever use the Vercel address.

The quick tunnel's `https://….trycloudflare.com` address changes whenever the
tunnel restarts, so the site can't have it built in. Instead:

- The Pi runs a small service (`manhunt-publish`) that watches the tunnel.
  When the address changes, and the new one answers, it saves the address in
  the Vercel project's [Edge Config](https://vercel.com/docs/edge-config), a
  small key-value store that is free on every plan. It only writes on a change.
- When the app opens, it asks `/api/server-origin` (a Vercel function,
  `api/server-origin.js`) where the server is now, then connects there. It
  remembers the last answer, so a weak signal that drops the lookup still
  connects.

If the Pi is off, creating a lobby says "The game server is offline".

### Set it up

1. **Import the repo in Vercel** (Add New → Project → this repository) and
   deploy. `vercel.json` sets everything: the build (`npm run build:vercel`),
   the `dist` output, and a rewrite so invite links like `/lobby/<id>` open
   the app. Note the site's address, e.g. `https://your-project.vercel.app`.
2. **Create the Edge Config.** In the project, open **Storage → Create
   Database → Edge Config**, name it (`manhunt`), and connect it to the
   project for all environments. Connecting adds an `EDGE_CONFIG` environment
   variable that the function reads. Copy the store's ID, which starts with
   `ecfg_`.
3. **Redeploy** (Deployments → the latest one → ⋯ → Redeploy) so the function
   picks up `EDGE_CONFIG`.
4. **Create an access token** for the Pi under **Account Settings → Tokens**.
   Pick the scope that owns the project. Choosing *No expiration* saves
   renewing it. If the project belongs to a team rather than your personal
   account, also copy the team ID (Team Settings → General, `team_…`).
5. **Set up the Pi** (see [the full guide](#set-up-the-server-with-cloudflare-raspberry-pi-or-any-linux-box)
   for a fresh machine):

   ```bash
   scripts/setup-server.sh --quick \
     --vercel-site https://your-project.vercel.app \
     --vercel-token <TOKEN> \
     --edge-config ecfg_xxxxxxxx
   ```

   Add `--vercel-team team_xxxxxxxx` for a team project. The script also
   allows the Vercel site to use the server. At the end it checks that the
   site reports the tunnel's address:

   ```
   ✓ https://your-project.vercel.app/api/server-origin → https://calm-river-otter.trycloudflare.com

     Play at:  https://your-project.vercel.app
   ```

6. **Play**: open the Vercel address on a phone and create a lobby. The
   invite QR code points at the Vercel address too, so it keeps working
   whatever the tunnel's address is.

After a reboot the tunnel comes back with a new address. The publisher sees
it within about ten seconds of it answering, and from then on newly opened
apps connect there. Lobbies live in the server's memory, so a reboot ends
games either way.

The token can manage your Vercel account, so the script keeps it in
`/etc/cloudflared/manhunt-publish.env`, readable by root only. If it expires
or you revoke it, `journalctl -u manhunt-publish` shows `Vercel answered 403`.
Re-run the script with `--vercel-token <NEW TOKEN>` to replace it.

Preview deployments get their own `*.vercel.app` addresses. Allow any you
want to play on with `--allow-origin https://….vercel.app`.

### With your own domain instead

A tunnel on your own domain (`--hostname`, below) has a fixed address, so no
Edge Config is needed. In the Vercel project, set the environment variable
`VITE_API_ORIGIN` to `https://manhunt.yourdomain.com` (no trailing slash) and
redeploy. Then allow the site on the server with
`scripts/setup-server.sh --allow-origin https://your-project.vercel.app`.

## Play over the internet (Cloudflare Tunnel)

To play with friends who aren't on your Wi-Fi, expose the whole app (frontend,
API and websocket) through one public HTTPS URL. HTTPS is required: phones only
allow location, keep-screen-on, the camera and the iOS compass on secure pages.

Cloudflare Tunnel is free, has no bandwidth cap for an app like this, supports
WebSockets, and needs no router port forwarding.

```bash
npm run tunnel
```

This builds for single-origin, starts the server, opens a Cloudflare **quick
tunnel**, and prints a random `https://….trycloudflare.com` URL. Open it on
your phone, then use the in-app **Invite** button (QR code / link) to get
everyone else in. The URL changes every run and needs no Cloudflare account.

To keep the server running on an always-on machine such as a Raspberry Pi,
with the same kind of trycloudflare.com address or your own domain, use
`scripts/setup-server.sh` ([below](#set-up-the-server-with-cloudflare-raspberry-pi-or-any-linux-box)).

Prerequisite: the `cloudflared` CLI
([downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).

## Set up the server with Cloudflare (Raspberry Pi or any Linux box)

`scripts/setup-server.sh` turns a fresh Raspberry Pi (or any Debian/Ubuntu
machine) into a server anyone can reach over HTTPS. It installs Node 22 if
needed, builds the app, and runs it as a service that starts on boot. It also
installs `cloudflared` and connects a Cloudflare Tunnel. A Pi 4 or 5 runs
the whole app comfortably. Nothing on your router needs changing, and the
tunnel is free with no bandwidth cap for an app like this.

There are two kinds of address:

| | Cloudflare's address (`--quick`) | Your own domain (`--hostname`) |
| --- | --- | --- |
| Looks like | `https://calm-river-otter.trycloudflare.com` | `https://manhunt.yourdomain.com` |
| Needs | Nothing: no account, no domain | A free Cloudflare account with a domain on it |
| Address | Changes whenever the tunnel restarts (a reboot, say) | Fixed |
| Frontend on Vercel | Yes; the site follows the address ([setup](#frontend-on-vercel-server-through-cloudflare)) | Yes |

### What you need

- The Pi (Raspberry Pi OS 64-bit) or another Debian/Ubuntu machine, online.
- For your own domain only: a free Cloudflare account with the domain added
  under **Add a site** (point your registrar's nameservers at Cloudflare), or
  bought through Cloudflare Registrar.

### Run it: Cloudflare's address

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/That-Coder-Guy/ManhuntApp.git ~/ManhuntApp
cd ~/ManhuntApp
scripts/setup-server.sh --quick
```

Run it as your normal user; it asks for `sudo` when it needs to. At the end
it prints the address:

```
  Play at:  https://calm-river-otter.trycloudflare.com
```

Open it on your phone and start a lobby. The in-app **Invite** QR code and
link use whatever address you opened, so friends join through the same one.

The address stays the same while the tunnel keeps running, but Cloudflare
hands out a new one each time it restarts: after a reboot, a power cut, or
re-running the script with a different `--port`. Re-running the script with
nothing changed leaves the tunnel, and its address, alone. To see the current
address at any time:

```bash
scripts/setup-server.sh --url
```

Cloudflare offers quick tunnels without any uptime guarantee. They are
reliable enough for games with friends; for something permanent, use a domain.

### Run it: your own domain

```bash
scripts/setup-server.sh --hostname manhunt.yourdomain.com
```

The first run prints a Cloudflare login link. Open it on any device (your
phone is fine) and pick the domain. The script then creates a tunnel called
`manhunt`, adds the DNS record for the hostname, starts both services, and
checks that `https://manhunt.yourdomain.com` answers.

Prefer the dashboard? Create the tunnel there (**Zero Trust → Networks →
Tunnels → Create a tunnel → Cloudflared**), give it a public hostname with
service `http://localhost:3001`, copy the token from the install command it
shows, and run:

```bash
scripts/setup-server.sh --token <TOKEN> --hostname manhunt.yourdomain.com
```

(`--hostname` is only used here to check the address works.) The token is
stored in `/etc/cloudflared/manhunt-tunnel.env`, readable by root only.

Frontend on Vercel? See [Frontend on Vercel](#frontend-on-vercel-server-through-cloudflare).

Add `--dry-run` to any command to see what it would do without changing
anything; `--help` lists every option (`--port`, `--tunnel-name`,
`--no-tunnel`, `--no-build`). You can switch between kinds of address later
by re-running with `--quick` or `--hostname`.

### Update

```bash
cd ~/ManhuntApp && git pull && scripts/setup-server.sh
```

Re-running keeps the port, allowed origins and tunnel from last time,
rebuilds, and restarts the app. The tunnel is only restarted if its settings
changed, so a quick tunnel keeps its address. Restarting the app ends live
games (lobbies are in memory), so update between rounds.

### Check on it

```bash
systemctl status manhunt manhunt-tunnel        # both should be "active (running)"
journalctl -u manhunt -f                       # app logs
journalctl -u manhunt-tunnel -f                # tunnel logs
scripts/setup-server.sh --url                  # the public address
curl https://<your-address>/manhunt-api/health   # {"status":"success"}
```

- **Error 1033 or 530** from Cloudflare: the tunnel isn't connected; check
  `journalctl -u manhunt-tunnel`.
- **Error 502**: the tunnel is up but the app isn't; check `journalctl -u manhunt`.
- **Not resolving yet**: a brand-new DNS record or quick-tunnel address can
  take a minute or two.

### Just one game, no server

`npm run tunnel` (on any machine with `cloudflared` installed) builds, starts
the server and opens a quick tunnel in the foreground, without installing any
services. It prints the `https://….trycloudflare.com` address, and Ctrl-C
stops everything.

### Remove it

```bash
sudo systemctl disable --now manhunt manhunt-tunnel manhunt-publish
sudo rm -f /etc/systemd/system/manhunt{,-tunnel,-publish}.service
sudo rm -f /etc/cloudflared/manhunt-tunnel.* /etc/cloudflared/manhunt-publish.env   # config and tokens
sudo systemctl daemon-reload
cloudflared tunnel delete manhunt              # if the script created it
```

Doing it by hand instead: `deploy/manhunt.service` is a plain systemd unit for
the app. Server settings, as environment variables:

- `PORT` — server port (default `3001`).
- `ALLOWED_ORIGINS` — extra comma-separated origins to allow (split hosting).
- `TRUST_ALL_ORIGINS=1` — allow any origin (disables the CORS allowlist).

## Hosting a game

Whoever creates a lobby is its host (the server gives the creator a secret
host key, kept with their session). In the pregame lobby everyone sets a
name, a small profile picture and a role; the host sets the rules and starts.

- **Play area**: the host draws a polygon on a map (tap to place corners, drag
  to move, tap a corner to remove it, tap a hollow handle to add one). Players
  outside it are flagged to everyone and told the way back. The inside test
  lives in `shared/geofence.js`, used by both the app and the server.
- **Time limit** (the hiders win when it runs out) and **head start** (seekers
  wait; hiders' positions stay hidden until it ends).
- The host can move players between roles, hand over the host role, remove
  players, end the game and start another round. The server enforces all of
  this, not just the UI.

Map tiles come from OpenStreetMap (free, attribution shown on the map). Tiles
already seen are cached by the service worker for patchy connections.

## Regenerating the walkthrough screenshots

```bash
npm i -D playwright && npx playwright install chromium   # once
npm run screenshots
```

`scripts/capture-walkthrough.mjs` builds the app, runs the real server on a
free port, plays a scripted five-player game in five browser "phones" and
writes every image above to `docs/walkthrough/`. Options:

- `STUB_TILES=1` draws a stand-in street map instead of loading OpenStreetMap
  (for machines that can't reach it).
- `--no-build` reuses the current `dist/`.

## Compass / device orientation (Android & iOS)

The compass arrow works across platforms via `src/hooks/useCompassHeading.js`
(pure math in `src/utils/orientation.js`, unit-tested with `npm test`):

- **iOS Safari**: uses `webkitCompassHeading` (a true clockwise heading) behind
  the iOS tap-to-grant permission prompt.
- **Android Chrome / Samsung Internet**: uses `deviceorientationabsolute`.
  Spec `alpha` is *counterclockwise* and only meaningful with tilt taken into
  account, so the heading is computed as the horizontal projection of the
  device's top axis, then screen-rotation compensated and smoothed.
- **Firefox Android**: falls back to `deviceorientation` events flagged
  `absolute: true`.
- Relative orientation events (arbitrary, drifting zero) are never used.
- Devices with no magnetometer are detected at runtime and get a cardinal
  direction fallback ("Head NE" + distance) instead of a dead arrow.

Requirements: sensors only work over **HTTPS**, and any proxy must not send a
`Permissions-Policy` header that blocks `accelerometer`, `gyroscope`, or
`magnetometer`.
