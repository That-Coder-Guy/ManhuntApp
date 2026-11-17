# Manhunt for iPhone

A native iOS app around the Manhunt web app, built and installed from Windows or Linux with [xtool](https://xtool.sh): no Mac, no App Store, no paid developer account.

It is a shell, not a second copy of the game. The app opens the web app from your game server in a full-screen web view, so it always shows the version the server runs, and nothing in the web app or server was changed to make it. What the app adds is the phone's own location service and a few other things a web view can't do by itself.

Signed with a free Apple ID, the app runs for **7 days**. After that it won't open until you install it again (same command; your name and settings on the phone are kept).

## What's different from the web app

| | iOS app |
|---|---|
| Location | From the app's own location service. iOS asks once, as for any app |
| Compass, camera | iOS asks once; the web view's extra "allow this site?" prompts are skipped |
| Keep screen on | Works (handled by the app; web views have no wake lock) |
| Permissions | Asked once on first open, like the Home Screen app. No offer to "add to Home Screen" |
| Notifications | **Not available.** A free Apple ID can't sign an app for push notifications |
| Offline | The app needs the server to open (there's no service worker in a web view) |
| Updates | Always the server's version. Left on the landing page for 30 minutes, it reloads when you come back |
| Background | As in the web app: location and the connection stop while the app is in the background |

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
| `Sources/Manhunt/Resources/bridge.js` | Runs in the page before the web app: hands `navigator.geolocation`, permission checks and the wake lock to the app, and says it's the installed app |
| `Sources/Manhunt/GameWebModel.swift` | The web view, and the app's side of that bridge |
| `Sources/Manhunt/LocationBridge.swift` | The phone's location service |
| `Sources/Manhunt/ServerStore.swift`, `ServerSetupView.swift` | Choosing and remembering the server |
| `Sources/Manhunt/GameScreen.swift` | The web view on screen, and the "can't reach the server" screen |
| `xtool.yml`, `Info.plist`, `Resources/AppIcon.png` | Bundle ID, permission wording, icon (rendered from `public/icon.svg`) |
| `build.sh`, `install.cmd`, `tools/usbmux-relay.cjs` | Building, and reaching the phone from WSL |

The bridge only answers the game server's own page, and only that page is given the camera and compass. Links to anywhere else open in the browser.

## Tests

```bash
node --test ios/tests/bridge.test.mjs
```

covers the bridge script against a stand-in page. The Swift side can only be checked by building it (`ios/build.sh --build-only`) and on a phone.
