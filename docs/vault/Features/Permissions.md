---
tags: [manhunt, feature]
---
# Permissions

## When they're asked
- **Browser**: **Before you play** opens on entering a lobby (`PermissionsGate.jsx`). Continue waits for the required ones.
- **Installed app** (Home Screen): **Set up Manhunt** opens once, on first launch (`PermissionsSetup.jsx`). Lobbies don't ask again.
- **Both**: a **Settings** page behind the gear on the home page (`src/pages/Settings.jsx`).

All three share one list (`PermissionsList.jsx`, hooks in `src/hooks/usePermissions.js`).

## The list
Required first, then optional:

| Switch | | Notes |
|---|---|---|
| Location | Required | Locks once allowed (a page can't revoke it) |
| Compass | Required | iPhones only (motion permission). A refusal is forgotten when the app reopens |
| Notifications | Optional | Turns off and on; see [[Notifications]] |
| Camera | Optional | Installed popup and Settings only. Just saves the QR scanner a prompt. Turns off and on (an app-level setting) |
| Keep screen on | Optional | No permission needed. Only during games; on by default |

## Details that matter
- **Status line**: shown only when it says something the switch can't. *Asking…* (grey), *Blocked* (red, nothing more), *Only in the Home Screen app*, *Not available on this device*.
- **No flicker**: the browser's last answer is remembered (`manhunt.permissionAnswers`), so switches open in their real state. On a first-ever visit the list stays hidden for the few milliseconds until the browser answers.
- **Tags line up**: *Required* and *Optional* line up, because each title takes the width of the longest one (measured once laid out). On 320 px screens they wrap under the titles.
- **Fits the screen**: the popups are capped to the screen; only the switches scroll between a fixed title and button.
