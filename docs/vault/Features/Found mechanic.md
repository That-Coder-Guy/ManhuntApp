---
tags: [manhunt, feature]
---
# Found mechanic

- A hider within the **found range** of a seeker taps **I've been found**, confirms, and joins the seekers.
- **Range**: 50 m by default. The host picks 10–300 m in the menu; the server accepts 10–500.
- **Server checks the distance itself**, using only seeker fixes from the last 2 minutes, and never during the head start.
- **Everyone is told**: a message in the app, and a push to anyone not looking ([[Notifications]]).
- **Game over**: when the last hider is found, everyone sees *game over* (seekers win) until the host takes everyone back to the lobby. Only the host has that button. Roles go back to how they were at the start.
- **The button only gives away what the host allows**:
  - In *distance* mode it unlocks when the reported distance is in range ("A seeker is 33 m away").
  - Otherwise it's always tappable and the server decides ([[Hider seeker info]]).
- **Uses steadied positions**: the found check uses the hider's steadied position ([[Steady hider positions]]).

Code: `server/game.js` (`nearestSeeker`, settings), the `found` handler in `server/server.js`, and `FoundFooter` in `src/components/GamePanels.jsx`.
