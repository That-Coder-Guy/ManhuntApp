---
tags: [manhunt, ios]
---
# iOS app

A native iPhone app in `ios/`, added 2026-11-17. It is a **shell around the web app**: a full-screen web view that opens the game server's own address, so it always runs the server's version. Nothing in `src/`, `server/` or the build was changed for it. `ios/README.md` is the full guide.

Built and installed from Windows (WSL) with [xtool](https://xtool.sh), signed with a free Apple ID: no Mac, no App Store. That removes the "needs a Mac" hurdle noted in [[Decisions]].

## What it's for
Background processing: a player locks the phone or switches apps and **stays in the lobby, sending their position**. A web page can't (see [[Decisions]]), which is why the web app keeps the screen on; the app doesn't offer that. A disconnect then means the phone really lost signal, or the player closed the app.

## Staying in the lobby, and notifications
Asked for by the owner on 2026-11-17, with no server or web app changes.
- **Background location is what keeps it running.** `Info.plist` has the `location` background mode; while the player is in a lobby `LocationBridge.swift` keeps the location service on, and each fix it hands the page wakes the page, which keeps the socket alive. "While Using the App" permission is enough, and Background App Refresh isn't involved.
- The web app leaves its socket on `window.__manhuntSocket`. `bridge.js` (one file shared with the [[Android app]]) listens on it for joining and leaving a lobby and for `player-found`.
- **A find while the app is off screen** becomes a local notification (`NotificationBridge.swift`) with the web push's own wording. Local, not pushed, so a free Apple ID is enough.
- **No web push.** The web app's Notifications switch drives iOS's permission through stand-ins for `Notification`, `PushManager` and the missing service worker; the server sends this phone nothing, the "Still playing?" reminder included ([[Notifications]]).
- **Swiping the app closed ends it**: iOS allows nothing else.
- **A blocked permission**: the web app's permissions page shows **Open settings** ([[Permissions]]); the app's alert says what Manhunt needs and opens its page in iOS's Settings.
- **Turning a permission off**: the web app's popup for a switch that's on ([[Permissions]]) has **Open settings**, which opens the app's page in iOS's Settings directly, without the alert (`GameWebModel` reads `direct` from the `settings` message).

## What else it adds
- **Location** from the phone's own location service, so iOS asks once.
- **Camera and compass** without the web view's own extra prompts.
- The web app is told it's the **installed app**: no [[Install offer]], and the one-time [[Permissions]] popup.

## What it lacks
- **Offline**: no service worker in a web view, so it needs the server to open. [[App updates and version]] doesn't apply; it reloads from the server instead.

## The 7 days
A free Apple ID signs the app for 7 days. Renew by plugging the phone in and running `ios\install.cmd`; settings on the phone are kept.

## The server address
Built in since 2026-11-21: `https://manhunt.fly.dev`, in `Sources/Manhunt/Server.swift` (Android: `app/build.gradle.kts`). The owner asked for the address screen to go once the game had a fixed address ([[Deployment]]). Gone with it: the first-launch screen, **Change server** on the "can't reach the server" screen (it has only **Try again** now) and on the app icon's menu. On an upgrade the app clears the old icon-menu item and the saved address, which iOS would otherwise keep. `build.sh --server` (Android: `install.mjs --server`) still builds a different address in, for trying a test server.

## Setup facts worth keeping
- xtool 1.24.0, Swift 6.4.2 and usbmuxd live in WSL (Ubuntu). The iOS SDK came from `Xcode_27.1.xip`; give xtool the WSL path (`/mnt/c/…`), not the Windows one.
- The phone is reached through Windows' Apple Mobile Device Service, relayed into WSL by `ios/tools/usbmux-relay.cjs`. No USB driver or admin rights.
- **If xtool's Apple ID sign-in fails** (it did at first, with HTTP 401 and then `-22411` after the code): check <https://www.apple.com/support/systemstatus/> before anything else. Those failures coincided with an Apple sign-in incident, and the same login worked once Apple recovered.

## Checked so far
- The first version (no background running) was installed on the owner's iPhone and connected to the Pi's server (2026-11-17).
- The background version builds with no warnings. Its bridge script was run against the real web app in a desktop browser set up like the app's web view, and `node --test ios/tests/bridge.test.mjs` covers it.
- **Not yet tried on the phone:** staying connected and sending positions while locked, the notifications, the "Allow it in Settings" alert, and whether iOS keeps the page awake for a long game. Also still unconfirmed: the compass and the QR scanner. The version with the address built in (2026-11-21) builds, but hasn't been installed on the phone.
