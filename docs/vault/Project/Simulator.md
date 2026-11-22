---
tags: [manhunt, testing, simulator]
---
# Simulator

Up to four phones side by side in one browser window, each running the real web app against a real game server on this computer, in a game that starts by itself with everyone walking about at random. Added 2026-11-22: the owner asked for "a simulator where I can see up to 4 simulated web apps on mobile phones at the same time", with the game "started automatically" and movement "random".

```bash
npm run simulate                  # build, start, open http://localhost:3210/simulator
npm run simulate -- --no-build    # reuse dist/
npm run simulate -- --no-open     # don't open the browser
npm run simulate -- --port 4000   # another port (a free one is taken if 3210 is in use)
```

## What it is
- `scripts/simulate.mjs`: builds the app, starts `createGameServer({ distDir: null, push: null })` in its own process on `127.0.0.1`, and serves the app itself so it can add one `<script>` to the page: `scripts/simulator/phone.mjs`. `/sw.js` answers 404 and the page is sent `no-store`. The bare address in a tab redirects to `/simulator`; in a frame it is the app's first page.
- `scripts/simulator/page.html` + `page.mjs`: the simulator's page. Makes a lobby (`POST /manhunt-api/create-lobby`), puts each phone in a 390×844 frame scaled to fit (one row or two), moves the phones once a second, and draws where they really are.
- `scripts/simulator/phone.mjs`: runs before the app in every page served, and does nothing unless the page is a frame whose `window.name` holds a phone's part in the game (JSON, set by `page.mjs`). **The app's source isn't changed for the simulator.**

## What the phone script does
- **Saved data kept apart.** The phones share one browser, so one `localStorage`. `window.localStorage` is replaced by a stand-in that keeps each phone's keys under `sim:<lobby>:<phone>:`. Per lobby as well, so two simulator tabs don't share phones. The page removes a game's keys when it is replaced, and any game's a day after it was made.
- **Location and compass.** `navigator.geolocation` is a stand-in fed by the page (`postMessage`, once a second, accuracy 8 m); `permissions.query` says location is allowed. `deviceorientationabsolute` events are sent five times a second, pointing the phone the way it walks: the compass hook gives up if none arrive in its first 3 seconds.
- **No service worker** (`Navigator.prototype.serviceWorker` is deleted, so no notifications either): it would serve the page from its cache, without the script. Wake lock is a stand-in.
- **Joining and starting.** It presses Continue on "Before you play", then takes its name and side (`update-player`). The host's phone sends `update-settings` and `start-game` once every phone is in with its name and the seekers are counted. Each is done once per game (`sim.ready`, `sim.started` in the phone's saved data), so after the game is ended the lobby is the player's to run.
- It hooks the app's socket by trapping the assignment of `window.__manhuntSocket` (the app's own testing handle), so no message is missed. The app deletes the handle when it lets a socket go, which removes the trap; a timer sets it again.

## Choices
- **Frames on one origin, not one origin per phone.** `sim1.localhost`-style origins would keep storage apart for free, but a browser set to block third-party storage refuses it to those frames. One origin and a storage stand-in works everywhere.
- **Movement lives in the page, not the phones.** One clock for all of them, a pause button, the true-position picture, and a reloaded phone is still where it was.
- **Jammers charge in 30 seconds** (`SETTINGS` in `page.mjs`), not 15 minutes, so a jam can be tried. Every other setting is the game's default. The panel says so.
- **Movement:** still 30% (20–60 s), walking 55% (1.0–1.7 m/s, 20–60 s), running 15% (2.6–3.6 m/s, 8–25 s); everyone sets off moving. Seekers start within 25 m of the middle, hiders 130–260 m out, so nobody starts in found range. At 350 m a phone turns back. Standing still long enough is what shows the [[Hider position blur]] at its widest.
- **One phone** joins and waits in the lobby: a game needs a seeker and a hider.

## Checked (2026-11-22, in the app's browser pane)
Four phones joined and the game started within a few seconds; saved data was kept apart; a jam on one phone showed on the seeker's; compass, map with real tiles and blur text all worked; Reload kept the same player; New game, 1, 2 and 4 phones and 2 seekers all worked; no console errors. Not tried in Firefox or Safari.

See [[Testing]] for the automated suites: the simulator is for looking, not for pass or fail.
