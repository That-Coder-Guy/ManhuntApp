---
tags: [manhunt, decisions]
---
# Decisions

Choices made along the way, with the reason, so they aren't re-litigated by accident.

## Hosting
- **Not Vercel.** Tried a Vercel frontend with the server on the Pi; it fought deployment protection and token scopes and was dropped.
- **Not workers.dev.** A Cloudflare Worker gave a permanent address but was dropped at the owner's request.
- **Quick tunnel from the Pi**, serving app and API from one address. Free, no domain; the address changes when the tunnel restarts. See [[Deployment]].
- **Fly.io as the way off the Pi** (chosen and deployed 2026-11-21: `https://manhunt.fly.dev`). The Pi's tunnel stalled and dropped, and its address changes. The owner asked whether the host's phone could be the server: not usefully, since phones on mobile data can't accept connections, so a relay with a public address is needed either way, and the host's phone would become a single point of failure. A small always-on cloud machine runs the existing server unchanged. Fly.io over Render's free plan because that one sleeps after 15 idle minutes and may restart at any time, which ends games (lobbies are in memory). Unlike the Vercel and workers.dev attempts above, this runs the server as it is.

## Map rotation without a plugin
`leaflet-rotate` is the usual way to rotate a Leaflet map, but it's **GPL-3.0**: bundling it would put the whole app under the GPL, and the repo has no license yet. So rotation is built in: a CSS-rotated square with counter-rotated pins and controls, and a small patch so drags follow the finger. See [[Tracking map]].

## Indoor GPS: averaging first, selfies later
Averaging fixes by their reported accuracy fixes the jitter (a ~40 m scatter shows as ~10 m) but not a building's steady offset. A "send a selfie if you stay put while hunted" rule was offered as the alternative; it's held in reserve. See [[Steady hider positions]].

## Hiders don't receive seekers' coordinates
Whatever the host chooses in [[Hider seeker info]], the server works it out and sends only that, so it can't be read around on the phone.

## No background location (yet)
Web apps can't run in the background on iOS or Android: timers stop, location stops, and a service worker only wakes for pushes. So:
- [[Notifications]] carry the moments that matter (found, about to be removed).
- Games keep the screen on.
- Real background tracking needs a native wrapper (Capacitor):
  - on iOS, a Mac (or cloud Mac) and App Store review;
  - on Android, a foreground service, buildable on Linux.

Apple's **Find My** network has no third-party API, and the unofficial routes aren't usable.

## Permissions: browser vs installed app
- The browser asks in **Before you play** on entering a lobby.
- The installed app asks once on first open, with a Settings page for later.
- Location and (on iPhones) the compass are required; the rest is optional and can be turned off.

See [[Permissions]].

## Shake to undo: an iframe, not a value reset
In WebKit, setting a field's value does **not** clear the undo history; closing a frame does. See [[Shake to undo fix]].

## The lobby's toolbar: chat, players, and a menu (2026-11-22)
The toolbar had grown to five buttons for a host in a game: chat, invite, players, end game, leave. The owner asked for "the exit and invite code menu bar items" to move "into a unified menu button" that opens "a popup menu", and then for "the host's stop game option" to go into it too.
- The toolbar is now always **chat, players, ···**. (A hider's Abilities button was tried there and moved to the game screen at the owner's word: [[Jamming]].) The **···** button opens a popover under itself: **Invite players**, **End game** (the host, during a game, only), **Leave lobby** (in red, last).
- What stays on the bar is what's used during play; what moved is used once or twice a game.
- Ending and leaving still ask first ("End the game?", "Leave lobby?"). The menu doesn't replace the confirmation: it's one tap further from an accident, not a substitute.
- A popover, not the action sheet the row menus use: the owner asked for a popup from the button, and a two- or three-line list reads better there than as a sheet across the bottom.
- The items keep the old buttons' test IDs (`invite-btn`, `end-game-btn`, `leave-btn`); `menu-btn` opens them. Checked by `tests/e2e/suites/lobby-menu.mjs`.
- The title's room for the buttons was 6 px short of them (a long lobby name could run under the first one's edge); it's 9rem now. The suite checks it.
- The README's walkthrough screenshots still show the old toolbar until `npm run screenshots` is run.

Code: `LobbyFound.jsx` (`IonPopover`), `.lobby-menu` in `index.css`.
