---
tags: [manhunt, android]
---
# Android app

A native Android app in `android/`, added 2026-11-17. Like the [[iOS app]], it is a **shell around the web app**: a full-screen web view that opens the game server's own address. Nothing in `src/`, `server/` or the web build was changed for it. `android/README.md` is the full guide.

`node android/install.mjs` (or `android\install.cmd`) builds `android/Manhunt.apk` and installs it over USB. The APK isn't tied to a phone and doesn't expire: it can also be sent to a phone and opened there.

## What it's for
Background processing: a player locks the phone or switches apps and **stays in the lobby, sending their position**. A web page can't (see [[Decisions]]), which is why the web app keeps the screen on; the app doesn't offer that. A disconnect then means the phone really lost signal, or the player closed the app.

## Staying in the lobby, and notifications
Asked for by the owner on 2026-11-17, with no server or web app changes.
- The web app leaves its socket on `window.__manhuntSocket`. `bridge.js` (one file shared with the [[iOS app]]) listens on it for joining and leaving a lobby, the game starting and ending, and `player-found`.
- **While in a lobby**, `GameService` (a foreground service with a processor wake lock, showing "In a lobby" / "Game in progress") keeps the app alive, and `GameWebView` tells the page it is still on screen, so the web view's own location keeps running.
- **A find while the app is off screen** becomes an Android notification with the web push's own wording.
- **No web push.** The web app's Notifications switch drives Android's permission through stand-ins for `Notification` and `PushManager`; the subscription it then tries to make fails quietly, so the server sends this phone nothing, the "Still playing?" reminder included ([[Notifications]]).
- **Swiping the app away ends it** (the same as on iOS, where nothing else is possible).
- **A blocked permission**: the web app's permissions page shows **Open settings** ([[Permissions]]); the app's dialog says what Manhunt needs and opens its page in Android's Settings.
- **Turning a permission off**: the web app's popup for a switch that's on ([[Permissions]]) has **Open settings**, which opens the app's page in Android's Settings directly, without the dialog (`PageBridge` passes `direct` to `MainActivity.openPhoneSettings`).
- Firebase push was the alternative offered and turned down: it needs a Firebase project, a key on the Pi, and server changes.

## How it differs from the iOS app
- **Location, compass and camera are the web view's own.** The app only answers Android's permission prompts; there is no location bridge as on iOS. Keeping location going in the background takes `GameWebView`'s "still on screen" trick.
- **The service worker runs**, so offline and [[App updates and version]] work as in the web app.
- Because of that offline copy, the app would still open with the server down. So the app asks the server directly each time it loads, and shows **Can't reach the server** with **Try again** if it doesn't answer (but not when the phone is simply offline).
- No 7-day expiry, no Apple ID.

## Setup facts worth keeping
- Java was already on the PC (JDK 25). The Android SDK is at `C:\Users\hggle\Android\Sdk`, with an emulator and one Android 16 image; the test phone is the `manhunt_test` virtual device.
- Android Gradle Plugin 9.5.1, Gradle 9.9.1 (through `gradlew`), compiled against API 36. `androidx.core` is held at 1.18.0 because 1.19 needs API 37.
- The APK is signed with this PC's debug key. Built on another computer, it won't install over the old copy.
- `scripts/tunnel.cjs` (`npm run tunnel`) doesn't start on Windows (`spawn npm ENOENT`). For testing, the server and `cloudflared` were started by hand.

## Checked so far
- In the emulator, against a local server: server screen and errors (since removed), permission prompts, a lobby with a simulated fix, share sheet, QR viewfinder, back button, server-gone screen and retry, opening offline (2026-11-17).
- With the address built in (2026-11-21), in the emulator against the live server: an upgrade over a copy that had an old tunnel address saved opened `manhunt.fly.dev` and dropped the saved one; a fresh install opened straight to the game; with the server down it showed **Can't reach the server** with only **Try again**, which loaded the game once the server was back; Back left the app.
- Background, with a scripted second player: locked 2.5 min in a lobby and 2.5 min in a game, the server showed the player connected with a position at most 2 s old; a "found" while locked became a notification that opened the game; leaving stopped the service (2026-11-17).
- Blocked location: the permissions page's **Open settings**, the app's dialog, Android's Settings, and back in once allowed (2026-11-17).
- `node --test android/tests/bridge.test.mjs` covers the bridge script.
- Not on a real phone yet: real GPS, the compass, the buzz when a seeker is near, scanning a real code, and how a real phone's battery saver treats the app.
