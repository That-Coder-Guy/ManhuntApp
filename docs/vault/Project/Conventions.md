---
tags: [manhunt, conventions]
---
# Conventions

## Git
- Commit **directly to `main`**, no pull requests.
- Commit titles are imperative and say what changed for players ("Turn the seeker's map with the phone, like the compass dial"); the body says why and how.
- Commits made by Claude end with a `Co-Authored-By: Claude …` trailer.
- Before committing: `npm run lint`, `npm test`, `npm run build:selfhost`, the relevant browser suites ([[Testing]]), and fresh screenshots if the UI changed.

## Design (the "unslop" rules)
The app was redesigned with the *unslop* skill: quiet chrome, one accent, deliberate sizes.
- **Colour**: ink ramp `#07080d → #232836`, text `#eef0f5` / `#a3a9b8` / `#8990a2`, one accent (blaze orange `#ff7b2c`), green `#4cc38a` and red `#eb656a` only for meaning. Every text colour clears WCAG AA.
- **Type**: IBM Plex Sans for the interface, Plex Mono for figures and meta. Sizes follow iOS: 13 / 15 / 17 / 20 / 24 / 30 / 44 px (`--fs-*` tokens).
- **Spacing**: a 4 px grid (`--space-*` tokens); equal things get equal sizes.
- **Copy**: sentence case, no trailing periods on labels, no exclamation marks, short and specific. Don't repeat what a control already shows (e.g. no "On/Off" under a switch).
- **Signature**: the GPS fix dot (solid when fresh, a ring when stale).
- Motion: one easing curve, short; nothing loops for decoration.

## Code
- Comments explain why, in plain words.
- Player-typed text is never put into HTML strings (textContent only).
- The server decides anything that matters for fairness (positions, found range, roles); the app only shows.
