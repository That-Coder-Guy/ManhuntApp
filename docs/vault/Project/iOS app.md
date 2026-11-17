---
tags: [manhunt, ios]
---
# iOS app

A native iPhone app in `ios/`, added 2026-11-17. It is a **shell around the web app**: a full-screen web view that opens the game server's own address, so it always runs the server's version. Nothing in `src/`, `server/` or the build was changed for it. `ios/README.md` is the full guide.

Built and installed from Windows (WSL) with [xtool](https://xtool.sh), signed with a free Apple ID: no Mac, no App Store. That removes the "needs a Mac" hurdle noted in [[Decisions]], though this shell does not add background location.

## What it adds over the web app
- **Location** from the phone's own location service (`LocationBridge.swift`), so iOS asks once. A script run before the page (`Resources/bridge.js`) swaps it in behind `navigator.geolocation`.
- **Keep screen on** works (web views have no wake lock).
- **Camera and compass** without the web view's own extra prompts.
- The web app is told it's the **installed app**: no [[Install offer]], and the one-time [[Permissions]] popup.

## What it lacks
- **[[Notifications]]**: a free Apple ID can't sign for push. Accepted by the owner.
- **Offline**: no service worker in a web view, so it needs the server to open. [[App updates and version]] doesn't apply; it reloads from the server instead.
- **Background**: same as the web app.

## The 7 days
A free Apple ID signs the app for 7 days. Renew by plugging the phone in and running `ios\install.cmd`; settings on the phone are kept.

## The server address
Typed in on first launch and remembered. When the quick tunnel's address changes ([[Deployment]]), the app says it can't reach the server and offers **Change server**; a long press on the app icon offers it too.

## Setup facts worth keeping
- xtool 1.24.0, Swift 6.4.2 and usbmuxd live in WSL (Ubuntu). The iOS SDK came from `Xcode_27.1.xip`; give xtool the WSL path (`/mnt/c/…`), not the Windows one.
- The phone is reached through Windows' Apple Mobile Device Service, relayed into WSL by `ios/tools/usbmux-relay.cjs`. No USB driver or admin rights.
- **If xtool's Apple ID sign-in fails** (it did at first, with HTTP 401 and then `-22411` after the code): check <https://www.apple.com/support/systemstatus/> before anything else. Those failures coincided with an Apple sign-in incident, and the same login worked once Apple recovered.

## Checked so far
- Builds with no warnings; installed on the owner's iPhone; connects to the Pi's server and runs (2026-11-17).
- `node --test ios/tests/bridge.test.mjs` covers the bridge script.
- Not individually confirmed on the phone yet: the compass, the QR scanner, keep-screen-on during a game, and the app-icon **Change server** action.
