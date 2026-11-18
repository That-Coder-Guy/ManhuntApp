# Manhunt for iPhone

A native iOS app around the Manhunt web app, built and installed from Windows or Linux with [xtool](https://xtool.sh): no Mac, no App Store, no paid developer account.

It is a shell, not a second copy of the game. The app opens the web app from your game server in a full-screen web view, so it always shows the version the server runs, and nothing in the web app or server was changed to make it. What the app adds is what a web page can't do: it **keeps running with the phone locked**, so a player stays in their lobby and keeps sending their position without the screen on.

Signed with a free Apple ID, the app runs for **7 days**. After that it won't open until you install it again (same command; your name and settings on the phone are kept).

## What's different from the web app

| | iOS app |
|---|---|
| Phone locked, or another app in front | **The player stays in the lobby and keeps sending their position**, for as long as they're in one. iOS shows its blue location indicator meanwhile |
| Keep screen on | Not offered (it's left off the Settings page): it only existed because a web page stops when the screen goes off |
| Permissions | Offered on one page when the app first opens, which can be put off, and on the Settings page afterwards. Entering a lobby needs location and the compass; notifications and the camera are optional. No offer to "add to Home Screen" |
| A blocked permission | The permissions page has an **Open settings** button: the app says what Manhunt needs (location, while using the app, precise) and opens its page in iOS's Settings |
| Turning a permission off | Only iOS's Settings can. Tapping a switch that's on says so, and its **Open settings** goes straight to the app's page there |
| Location | From the app's own location service. iOS asks once, as for any app; "While Using the App" is enough |
| Notifications | The phone's own, made by the app when someone is found. Web push isn't used, and neither is the "Still playing?" reminder: there is no dropping out to remind about |
| Compass, camera | iOS asks once; the web view's extra "allow this site?" prompts are skipped |
| Offline | The app needs the server to open (there's no service worker in a web view) |
| Updates | Always the server's version. Left on the landing page for 30 minutes, it reloads when you come back |

## Staying in the lobby, and notifications

iOS stops an app soon after it leaves the screen unless it is doing one of a few things iOS allows in the background. Following the player's location is one, and it is what a game of Manhunt does anyway. So:

- **While the player is in a lobby** (before, during and after a game), the app keeps its location service running in the background. Each position it hands the page also wakes the page, which is what keeps the connection to the server alive. It stops when the player leaves the lobby.
- **This doesn't use Background App Refresh**, and doesn't need "Always" location: "While Using the App" covers it, because the app was on screen when it started.
- **When someone is found** and the app isn't on screen, it shows a notification in the words the web push would have used ("Maya was found · 1 hider left · Riverside Park"). These are made on the phone, not pushed, so they work with a free Apple ID.
- **The web app's own Notifications switch** (in *Set up Manhunt* and Settings) is what asks iOS for permission, and turning it off there turns them off.

So a disconnect now means something: the phone lost its signal or its battery, or the player closed the app. Limits:

- **Swiping the app closed ends it.** iOS gives an app no way round that. The player is then away, and the server removes them after its usual five minutes.
- **Battery**: location stays on for as long as the player is in a lobby.

## One-time setup

Everything here runs inside WSL (Ubuntu) on Windows, or directly on Linux.

1. **Swift, usbmuxd, xtool** (from xtool's [installation guide](https://xtool.sh/documentation/xtool/installation-linux)):
   ```bash
   sudo apt-get install usbmuxd libimobiledevice-utils libfuse2t64 socat rsync
   curl -O https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz && tar zxf swiftly-$(uname -m).tar.gz && ./swiftly init
   sudo curl -fL "https://github.com/xtool-org/xtool/releases/latest/download/xtool-$(uname -m).AppImage" -o /usr/local/bin/xtool && sudo chmod +x /usr/local/bin/xtool
   ```
2. **Xcode.xip**: download Xcode from <https://developer.apple.com/download/all/?q=Xcode> (a free Apple ID is enough; xtool's guide says which version it expects). xtool only takes the iOS SDK out of it.
3. **Sign in and install the SDK**:
   ```bash
   xtool setup
   ```
   Choose **Password** login for a free Apple ID, then give the path to the `.xip` (in WSL, a Windows download is at `/mnt/c/Users/<you>/Downloads/Xcode_….xip`). xtool's guide notes that password login uses Apple's private sign-in API and suggests a separate Apple ID if that worries you.
4. **On Windows**, the phone is reached through Apple's own device service, so install **Apple Devices** (or iTunes) from the Microsoft Store if it isn't there, plug the phone in and tap **Trust** on it. Nothing else is needed: no USB driver, no administrator rights (see `tools/usbmux-relay.cjs`).

## Install, and renew every 7 days

Plug the phone in, unlock it, then from Windows:

```bat
ios\install.cmd
```

or inside WSL / Linux:

```bash
ios/build.sh
```

Add `--server your-address.trycloudflare.com` to build the game server's address in; otherwise the app asks for it the first time it opens.

The first time, the phone needs two things, and xtool stops to say so:

- **Developer Mode**: Settings → Privacy & Security → Developer Mode (the switch appears after the first install attempt; the phone restarts).
- **Trust yourself**: Settings → General → VPN & Device Management → your Apple ID → Trust.

Then run the command again. A free Apple ID allows three sideloaded apps on a phone at a time.

## The server address

The app asks for the address once and remembers it. A quick tunnel's address changes when the tunnel restarts; when the old one stops answering, the app says so and offers **Change server**. To change it at any other time, long-press the app's icon and choose **Change server**.

The address must be `https` (the camera and compass need it), and the app checks that a Manhunt server answers there before using it.

## How it fits together

| | |
|---|---|
| `Sources/Manhunt/Resources/bridge.js` | Runs in the page before the web app. The same file as the Android app's (a test keeps the two copies identical): location, permission checks and notifications go to the app, and it tells the app when the player is in a lobby and when someone is found |
| `Sources/Manhunt/GameWebModel.swift` | The web view, and the app's side of that bridge |
| `Sources/Manhunt/LocationBridge.swift` | The phone's location service, and running in the background |
| `Sources/Manhunt/NotificationBridge.swift` | The "someone was found" notifications |
| `Sources/Manhunt/ServerStore.swift`, `ServerSetupView.swift` | Choosing and remembering the server |
| `Sources/Manhunt/GameScreen.swift` | The web view on screen, the "can't reach the server" screen, and the "Allow it in Settings" alert |
| `xtool.yml`, `Info.plist`, `Resources/AppIcon.png` | Bundle ID, permission wording, the location background mode, icon (rendered from `public/icon.svg`) |
| `build.sh`, `install.cmd`, `tools/usbmux-relay.cjs` | Building, and reaching the phone from WSL |

The bridge only answers the game server's own page, and only that page is given the camera and compass. Links to anywhere else open in the browser.

## Tests

```bash
node --test ios/tests/bridge.test.mjs
```

runs the bridge script against a stand-in page, as the iPhone app would run it (`ios/tests/bridge-suite.mjs` holds the tests, shared with the Android app).

The script was also run against the real web app in a desktop browser set up like the app's web view (no service worker, the app's message channel, positions fed in by hand): the web app started normally, showed its Notifications switch and no "Keep screen on", told the app when a lobby was joined, and sent on a position it was handed.

The Swift side can only be checked by building it (`ios/build.sh --build-only`) and on a phone. **Staying connected with the phone locked, the notifications, and the "Allow it in Settings" alert have not been tried on a phone yet.**
