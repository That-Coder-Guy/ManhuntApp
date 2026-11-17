---
tags: [manhunt, feature]
---
# App updates and version

## Version
- **Where it comes from**: `shared/version.js` reads git: build number (commit count), short commit, date. It's baked into the app at build time and reported by `/manhunt-api/health`.
- **Where it shows**: the landing page footer shows it. If the server runs a different version, the footer says so in red. [[Timeline]] maps numbers to changes.

## Updates (installed app)
The service worker uses `registerType: 'prompt'` (`src/utils/appUpdate.js`):
- **Checking**: on open, on coming back to the app, and every 30 minutes.
- **Applying, only at a safe moment**:
  - straight away on the landing page (unless typing);
  - a **Reload** strip in a lobby or on the results screen;
  - never mid-game.
- **Old copies**: copies too old to apply updates themselves are handed over by `public/sw-handover.js`.
