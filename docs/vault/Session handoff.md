---
tags: [manhunt, handoff]
---
# Session handoff

A long cloud session (Claude Code on the web) built most of the recent history in [[Timeline]]: hosting through the Cloudflare tunnel, the UI polish and icon, finding, the tracking map, updates, notifications, hider info, permissions, and everything after. This note is the bridge to the next session, wherever it runs.

## Where things stand
- `main` is at **Version 83** (`8abb790`), everything committed and pushed. This vault was added after it.
- All 108 unit tests and all 17 browser suites pass (2026-11-21; track-map's "Fit settles back" timing check still fails now and then in a full run and passes alone); the audits show only known notes ([[Testing]]).
- Nothing is half-done. The temporary test-notification button was added (Version 74) and removed again (Version 79).
- The Pi needs updating to get the latest: see [[Deployment]].

## Picking it up locally
1. `git pull` in your clone (or clone fresh), then `npm install` and `npm --prefix server install`.
2. Either continue this exact conversation with `claude --teleport` (the cloud session's **Open in CLI** gives the command, with its ID; it needs a clean checkout and the same Claude account), or start a new session and point it at this vault: "read `docs/vault/Session handoff.md` and the notes it links".
3. For browser tests, once: `npm i -D playwright && npx playwright install chromium`, then `npm run test:e2e` ([[Testing]]).

## Last asked, last done
The final requests were:
- the **map turning with the phone** like the compass ([[Tracking map]], Version 80);
- the **Required/Optional tags lined up** ([[Permissions]], Version 81);
- the **iPhone shake-to-undo popup** ([[Shake to undo fix]], Version 82);
- **browser tests moved into the repo** (Version 83);
- this vault.

## Needs a real phone
These can't be checked in a desktop browser; see [[Open questions]] for the full list.
- Notifications actually arriving (iPhone Home Screen app and Android).
- The shake-to-undo fix on an iPhone.
- The map turning smoothly with a real compass.
- Steadied hider positions inside a real building.

## Things only you can decide
- A license for the repo (there is none; it matters for any GPL code, see [[Decisions]]).
- Whether to add the selfie rule if indoor positions are still poor ([[Steady hider positions]]).
- Whether to go native later for background location ([[Decisions]]).
