---
tags: [manhunt, feature]
---
# Permissions

## Where they're asked
- **On entering a lobby**: **Before you play** (`PermissionsGate.jsx`). Continue waits for what a game needs; **Leave lobby** is the way out. The browser shows it on the way into every lobby. The installed app shows it only when something a game needs is still missing.
- **Installed app** (Home Screen web app, and the native [[iOS app]] and [[Android app]]): the permissions page, **Set up Manhunt** (`PermissionsSetup.jsx`), opens once, the first time the app does. It can be put off with **Not now**: the app opens without any of it.
- **The Settings page**, under **Permissions** (back since 2026-11-18): the same list with the camera, showing what's allowed, with a switch for what isn't yet. It's where a player who put the opening page off, or skipped an optional one at a lobby, can allow it later, and where the popup for turning one off is met. History: the switches were taken off Settings on 2026-11-17 at the owner's request, as redundant (a switch can't change a permission once it's answered); the owner then found them missing on the iPhone the next day, after asking for the turn-off popup, and they went back.

Both share one list (`PermissionsList.jsx`, hooks in `src/hooks/usePermissions.js`).

## The list
Required first, then optional:

| Switch | | Notes |
|---|---|---|
| Location | Required | |
| Compass | Required | iPhones only (motion permission). A refusal is forgotten when the app reopens |
| Notifications | Optional | See [[Notifications]] |
| Camera | Optional | The installed app's page only. Just saves the QR scanner a prompt |

## Why it's asked this way (Apple's rules)
The app keeps to Apple's App Store Review Guidelines, so that it could be submitted. (The sideloaded builds aren't reviewed.)
- **Only location and the compass are required**, because the game can't run without them. Notifications and the camera are conveniences, and an app may not demand those: **4.5.4** ("Push Notifications must not be required for the app to function") and **5.1.1(iv)** (no forcing consent to access the app doesn't need; a lobby ID can be typed instead of scanned).
- **Nothing is required just to open the app.** **5.1.2(i)** says an app may not require people to enable system functions, location services among them, in order to use it. So the opening page can be put off, and location is insisted on only where it's needed, on entering a lobby, with **Leave lobby** as the way out.
- **The switches are Apple's intended way to ask** (the phone's own prompt, from the app). The phone's Settings are the fallback after a refusal, which is how **Open settings** is used.

History, all 2026-11-17: the opening page first blocked the app until the required ones were allowed (the owner's request); then all four were required; both were withdrawn the same day once checked against these rules, at the owner's request.

## What a switch can and can't do
- **It asks.** That is all a page (or an app) can do with a permission.
- **Once allowed, it locks.** Only the phone's own settings can take a permission back. (Notifications and the camera used to switch "off" again: for notifications that was the app's own setting, and for the camera it did nothing. An "off" chosen in an older version is still kept to, and its switch turns it back on.)
- **Tapping a switch that's on** (added 2026-11-18, at the owner's request) brings up a popup: "Turn location off in your phone’s settings" (not just "Settings", which is also this app's own page), saying Manhunt can't turn it off itself and, for a required one, that a game can't be joined without it. In the native apps it has **Not now** and **Open settings**, which opens Manhunt's page in the phone's settings directly (`openSettings({ direct: true })`: the popup has already said why, so the app's own "what Manhunt needs" dialog is skipped). A browser can't open its settings, so there the popup only says where to look. The compass has no setting on any phone: its popup just says it stays on. The locked switch itself takes no taps, so the tap is caught on its row (`PermissionRow`'s `onLockedTap`); a tap on a blocked switch does what the **Open settings** button under the list does. The popup is an `<IonAlert>` in `PermissionsList.jsx`, and must start with `buttons: []` (Ionic's alert breaks, drawing nothing, if it's ever given `buttons={undefined}`).
- **Blocked** (refused, in red): the switch can't ask twice. A line under the list says only the phone's settings can allow it. In the native apps an **Open settings** button (`src/utils/nativeApp.js`) asks the app, which says what Manhunt needs there (location, while using the app, precise) and opens its page in the phone's settings; coming back, the page updates by itself.

## Settings (the gear on the home page)
How the app looks and behaves, not what it may use (`src/pages/Settings.jsx`, `src/utils/accessibility.js`):
- **Text size**: Default, Large (×1.125) or Larger (×1.25), through `--ui-scale`.
- **Reduce motion**: stills the compass needle's easing and Ionic's sliding panels. Starts as the phone's own "reduce motion" setting.
- **Keep screen on** (during a game): only where a page can keep the screen on. The native apps have no wake lock and don't need one, so they don't show it.

## Details that matter
- **Status line**: shown only when it says something the switch can't. *Asking…* (grey), *Blocked* (red, nothing more), *Only in the Home Screen app*, *Not available on this device*.
- **No flicker**: the browser's last answer is remembered (`manhunt.permissionAnswers`), so switches open in their real state. On a first-ever visit the list stays hidden for the few milliseconds until the browser answers.
- **Tags line up**: *Required* and *Optional* line up, because each title takes the width of the longest one (measured once laid out). On 320 px screens they wrap under the titles.
- **Fits the screen**: the popups are capped to the screen; only the switches scroll between a fixed title and button.

## Worth knowing
- **No way back to an optional one in a browser.** A player who skips notifications on the permissions page has no switch for them afterwards; in the native apps they can allow them in the phone's settings, but a web page can't be given notifications that way. Raised with the owner on 2026-11-17.
- **iPhone Home Screen web app**: if Safari forgets the location answer between openings, **Before you play** will show at the first lobby of each opening. Not yet seen on a phone ([[Open questions]]).
