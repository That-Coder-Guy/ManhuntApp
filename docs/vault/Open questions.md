---
tags: [manhunt, todo]
---
# Open questions

## Check on real phones
- [ ] **Notifications arrive**: someone found while your phone is locked (iPhone Home Screen app, iOS 16.4+, and Android). Also the "Still playing in …?" reminder about 3 minutes after closing the app. See [[Notifications]].
- [ ] **Shake to undo** no longer pops up on an iPhone after typing then leaving a field ([[Shake to undo fix]]).
- [ ] **Map rotation** feels right with a real compass, and dragging and pinching on the turned map ([[Tracking map]]).
- [ ] **Steady positions**: a hider inside a building shows within a sensible distance ([[Steady hider positions]]). If not, consider the selfie rule.
- [ ] **iPhone permissions**: does the compass permission persist in the Home Screen app, and does the camera still ask each session? ([[Permissions]])

## Small fixes on offer
- [ ] The "© OpenStreetMap" credit sits on a light box (Leaflet's stylesheet overrides the app's dark one). A one-line fix.
- [ ] In "nearby" and "none" hider modes, a hider could tap *I've been found* repeatedly to probe whether a seeker is within the found range (the server's yes/no answer). Minor; could be rate-limited ([[Hider seeker info]]).

## Decisions for the owner
- [ ] Add a license to the repo ([[Decisions]]).
- [ ] Native apps for background location, if ever wanted ([[Decisions]]).
- [ ] Selfie rule for hiders who stay put ([[Steady hider positions]]).
