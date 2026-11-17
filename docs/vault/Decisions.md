---
tags: [manhunt, decisions]
---
# Decisions

Choices made along the way, with the reason, so they aren't re-litigated by accident.

## Hosting
- **Not Vercel.** Tried a Vercel frontend with the server on the Pi; it fought deployment protection and token scopes and was dropped.
- **Not workers.dev.** A Cloudflare Worker gave a permanent address but was dropped at the owner's request.
- **Quick tunnel from the Pi**, serving app and API from one address. Free, no domain; the address changes when the tunnel restarts. See [[Deployment]].

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
