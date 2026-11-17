---
tags: [manhunt, feature]
---
# Notifications

Web Push, sent by the server through Apple's, Google's, Mozilla's or Microsoft's push services. A phone's service worker (`public/sw-push.js`) shows them; tapping one opens that lobby.

## What's sent
- **Someone was found**: "Maya was found · 1 hider left · Riverside Park", or "Everyone was found".
  - It goes to everyone with notifications on, except the found player and anyone looking at the app (phones report `set-visibility`).
- **About to be removed**: a player away from the app (closed, or a locked phone that dropped the connection) is removed after 5 minutes. With about 2 minutes left they get "Still playing in Riverside Park? Open Manhunt within 2 minutes…".
  - It's sent once per absence, and it expires with the deadline.

## How it fits together
- **Keys**: VAPID keys from `server/.vapid-keys.json` or `VAPID_*` ([[Deployment]]).
- **Who it can be sent to**: subscriptions are only accepted for known push hosts (an SSRF guard), and ones the push service reports gone are forgotten (`server/push.js`).
- **Joining a lobby**: the phone sends its subscription (or none) with `push-subscribe`.
- **Turning them on and off**: switched on from the permission lists ([[Permissions]]). Turning them **off** drops the phone's subscription and tells the server; turning back on doesn't ask again.
- **iPhone**: needs iOS 16.4+ and the **Home Screen app**. In Safari the switch says "Only in the Home Screen app" ([[Install offer]]).

## Untested so far
Real delivery to phones; the sandbox couldn't reach the push services. A temporary test button existed in Versions 74–78. See [[Open questions]].
