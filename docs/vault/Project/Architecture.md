---
tags: [manhunt, architecture]
---
# Architecture

## Pieces
- **Frontend** (`src/`): Ionic React 8 in iOS mode, Vite, Leaflet maps. Pages: `Home`, `Lobby`, `Settings`. A PWA via vite-plugin-pwa (service worker, offline, installable).
- **Server** (`server/`): Express + Socket.IO, all state in memory (a restart ends live games). It also serves the built frontend from `dist/`, so one address serves everything.
- **Shared** (`shared/`): `geofence.js` (play-area polygon maths, used by both sides) and `version.js` (the build number from git).

## Game flow
Lobbies go **lobby → playing → ended**. The creator gets a secret host key and is host; the host sets the rules ([[Found mechanic]] range, [[Hider seeker info]], play area, time limit, head start), starts the game and brings everyone back afterwards.

## Talking to the server
- One REST call creates a lobby (`POST /manhunt-api/create-lobby`); `GET /manhunt-api/health` reports the server's version.
- Everything else is one Socket.IO connection (`/manhunt-api/socket.io`), authenticated by `{ lobby_id, player_token }`; a stored token resumes the same player after a dropout.
- Phones send: location, profile, role, `found`, `push-subscribe`, `set-visibility`; the host sends settings and game controls. All are acknowledged.
- The server pushes `lobby-state` at most once a second per lobby. **During a game each player gets their own copy**: a hider's has no seeker's position (and of the other hiders, what the seekers have: [[Hider map]]), only the `seeker_info` the host allows (`viewFor` / `emitState` in `server/server.js`). Seekers see everything.
- A dropped player is kept **5 minutes** before removal ([[Notifications]] reminds them at about 2 minutes left).

## Where to look
| Concern | Files |
|---|---|
| Game rules, settings validation, distances | `server/game.js` |
| Sockets, views, timers, pushes | `server/server.js`, `server/push.js` |
| Lobby connection on the phone | `src/hooks/useLobbySocket.js` |
| One lobby's screens | `src/components/LobbyFound.jsx`, `GamePanels.jsx` |
| Seeker / hider views | `SeekerView.jsx`, `CompassArrow.jsx`, `TrackMap.jsx`, `HiderView.jsx` |
| Permissions | `src/hooks/usePermissions.js`, `PermissionsList/Gate/Setup.jsx`, `src/pages/Settings.jsx` |
| Location, compass, wake lock | `useGeolocation.js`, `useCompassHeading.js`, `useWakeLock.js`, `src/utils/positionFilter.js` |
| Updates, install, push on the phone | `src/utils/appUpdate.js`, `install.js`, `push.js`; `public/sw-handover.js`, `public/sw-push.js` |
| Design tokens and all styles | `src/index.css` |
