---
tags: [manhunt, feature]
---
# Install offer

On a phone's **first visit**, a popup offers to add Manhunt to the Home Screen (`src/utils/install.js`, `InstallOffer.jsx`):
- **Chrome / Edge**: an **Install** button that opens the browser's own install prompt (`beforeinstallprompt`).
- **iPhone**: "Tap the Share button, then Add to Home Screen".
- **Other Android browsers**: use the browser menu.

**When it shows.**
- Once only (`manhunt.installOffered`).
- Never inside the installed app.
- Not on computers that can't install.
- "Before you play" waits until it's closed.

**Why it matters on iPhones.** Only the Home Screen app gets [[Notifications]], and the installed app gets the one-time permissions popup ([[Permissions]]).
