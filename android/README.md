# Manhunt for Android

A native Android app around the Manhunt web app. Like the iPhone app in `ios/`, it is a shell, not a second copy of the game: it opens the web app from your game server in a full-screen web view, so it always shows the version the server runs, and nothing in the web app or server was changed to make it.

Unlike the iPhone app, the built `Manhunt.apk` is not tied to one phone and does not expire. It can be installed over USB or sent to any Android phone (Android 8 or later) and opened there.

What the app adds is what a web page can't do: it **keeps running with the phone locked**, so a player stays in their lobby and keeps sending their position without the screen on.

## What's different from the web app

| | Android app |
|---|---|
| Phone locked, or another app in front | **The player stays in the lobby and keeps sending their position**, for as long as they're in one. Android shows "In a lobby" or "Game in progress" in the notification shade meanwhile |
| Keep screen on | Not offered (it's left off the Settings page): it only existed because a web page stops when the screen goes off |
| Permissions | Offered on one page when the app first opens, which can be put off. Entering a lobby needs location; notifications and the camera are optional. No offer to "add to Home Screen" |
| A blocked permission | The permissions page has an **Open settings** button: the app says what Manhunt needs (location, while using the app, precise) and opens its page in Android's Settings |
| Turning a permission off | Only Android's Settings can. Tapping a switch that's on says so, and its **Open settings** goes straight to the app's page there |
| Location, camera | Android's own prompts, asked once. The web view's extra "allow this site?" step is answered by the app |
| Sharing an invite | Opens Android's share sheet (web views have no share) |
| Notifications | Android's own, made by the app when someone is found. Web push isn't used, and neither is the "Still playing?" reminder: there is no dropping out to remind about |
| Offline, updates | As in the web app: it keeps a copy of itself on the phone and updates itself |
| Server gone | The app checks the server each time it opens and says so, with **Change server**, instead of sitting on "reconnecting" |

## One-time setup

1. **Java 17 or later** (`java -version`).
2. **The Android SDK**: Android Studio installs it, or get the "command line tools only" download from <https://developer.android.com/studio> and run
   ```
   sdkmanager --sdk_root=<where> "platform-tools" "platforms;android-36" "build-tools;36.0.0"
   ```
   `install.mjs` looks in `ANDROID_HOME`, then the usual places (`~/Android/Sdk`, Android Studio's default). On this PC it is at `C:\Users\hggle\Android\Sdk`.

Gradle needs no install: `gradlew` fetches the right version itself the first time.

## Build and install

```bat
android\install.cmd
```

or, anywhere:

```bash
node android/install.mjs
```

This builds `android/Manhunt.apk` and installs it on every phone or emulator connected over USB. `--build-only` just builds.

**Over USB**, the phone needs USB debugging: Settings → About phone → tap **Build number** seven times, then Settings → System → Developer options → **USB debugging**. Plug it in and tap **Allow** on the phone.

**Without a cable**, send `Manhunt.apk` to the phone (a message, Drive, email) and open it. Android asks once to allow installing from that app, and Play Protect may warn that it doesn't recognise the developer; choose to install anyway.

Updates install over the old copy as long as they are built on the same computer: the APK is signed with that computer's debug key (`~/.android/debug.keystore`). An APK built elsewhere needs the old app uninstalled first.

## The server address

The app asks for the address once and remembers it. A quick tunnel's address changes when the tunnel restarts; when the old one stops answering, the app says so and offers **Change server**. To change it at any other time, long-press the app's icon and choose **Change server**.

The address must be `https`, and the app checks that a Manhunt server answers there before using it.

## Staying in the lobby, and notifications

Android stops an app's network and timers soon after its screen goes off, and a web view whose window is hidden stops reading location. So:

- **While the player is in a lobby** (before, during and after a game), the app runs a service that Android shows as an ongoing notification: **In a lobby**, or **Game in progress**. That keeps the app, its connection and its location alive with the phone locked or another app in front. It stops when the player leaves the lobby.
- **When someone is found** and the app isn't on screen, it shows a notification in the words the web push would have used ("Maya was found · 1 hider left · Riverside Park"). Tapping it opens the game.
- **The web app's own Notifications switch** (in *Set up Manhunt* and Settings) is what asks Android for permission, and turning it off there turns the "found" notifications off. The ongoing one stays: Android requires it while the service runs.

So a disconnect now means something: the phone lost its signal or its battery, or the player closed the app. Limits:

- **Swiping the app away ends it**, as on an iPhone. The player is then away, and the server removes them after its usual five minutes.
- **Battery**: the processor (not the screen) and location stay on for as long as the player is in a lobby.
- **Phone makers' battery savers.** Some phones stop background apps more eagerly than stock Android; if one drops players, exempt Manhunt from battery optimisation in the phone's Settings.

## How it fits together

| | |
|---|---|
| `app/src/main/assets/bridge.js` | Runs in the page before the web app. The same file as the iPhone app's (a test keeps the two copies identical): permission checks, sharing and notifications go to the app, and it tells the app when the player is in a lobby and when someone is found |
| `app/src/main/kotlin/.../PageBridge.kt` | The app's side of that bridge, given only to the game server's own page |
| `app/src/main/kotlin/.../MainActivity.kt` | The web view, Android's permission prompts, the "Allow it in Settings" dialog, and the server and "can't reach" screens |
| `app/src/main/kotlin/.../GameService.kt` | Keeping the app going while the player is in a lobby, and the notifications |
| `app/src/main/kotlin/.../GameWebView.kt` | A web view that carries on as if on screen, so the page keeps reading location with the phone locked |
| `app/src/main/kotlin/.../ServerStore.kt` | Remembering the server and checking it answers |
| `app/src/main/res/` | Layout, colours (from `src/index.css`), and the icon (redrawn from `public/icon.svg`) |
| `install.mjs`, `install.cmd` | Building and installing |

Location, the compass and the camera are the web view's own; the app only answers Android's permission prompts for the game server's page. Links to anywhere else open in the browser.

## Testing

```bash
node --test android/tests/bridge.test.mjs
```

runs the bridge script against a stand-in page, as the Android app would run it (the tests are shared with the iPhone app: `ios/tests/bridge-suite.mjs`).

The app itself was checked by hand in an emulator (Android 16) against a local server:

- the server screen and its errors, the permission prompts, a lobby with a simulated GPS fix, the share sheet, the QR scanner's viewfinder, the back button, the server-gone screen and retry, and opening with the phone offline;
- **locked in a lobby** for two and a half minutes, then **locked during a game** for another two and a half, with a scripted second player: the server kept showing the player connected, with a position never more than 2 seconds old, and a position changed while locked was the one the server used;
- a "found" while locked arrived as a notification and opened the game when tapped; the ongoing notification followed the game starting and ending; leaving the lobby stopped the service;
- **a blocked permission**: with location refused twice, the permissions page showed "Blocked" and **Open settings**; the app's dialog listed what's needed and opened Android's Settings for Manhunt; with location allowed there, the page let the player in on return. The Settings page showed only Text size and Reduce motion.

Not checked on a real phone: real GPS, the compass, the buzz when a seeker is near, scanning a real code, and how long a real phone's battery saver leaves the app alone.
