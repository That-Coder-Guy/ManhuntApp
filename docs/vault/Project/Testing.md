---
tags: [manhunt, testing]
---
# Testing

```bash
npm run lint
npm test                    # unit tests + socket-level server tests (78)
npm run test:e2e            # 17 browser suites, about 10 minutes
npm run test:e2e -- found   # just some (names from tests/e2e/suites/)
npm run audit:ui            # overflow, legibility, text position (notes, not pass/fail)
```
Browser tests need Playwright once: `npm i -D playwright && npx playwright install chromium`.

## How the browser tests work
`tests/e2e/run.mjs` builds the app (`--no-build` reuses `dist/`) and starts the real game server on a free port, with pushes **recorded to `tests/e2e/output/pushes.jsonl` instead of sent** and map tiles stubbed: no internet needed. Each suite drives several browser "phones". Screenshots land in `tests/e2e/output/` (gitignored).

Suites: found, seeker-info, jam, hider-blur, hider-map, chat, track-map, map-rotation, permissions, camera, settings-paint, install-offer, notifications, steady-position, shake-undo, popup-fit, tag-alignment.

## Known audit notes (harmless)
- Legibility: the selected segment's label ("Seeker"/"Hider", "Compass"/"Map") measured against the wrong layer.
- Text position: "‹ Home" and "‹ Hiders" text sits beside its chevron; the invite's long lobby ID is cut off by design.

## What a desktop browser can't test
Real push delivery, the iPhone shake gesture ([[Shake to undo fix]]), a real compass, iOS permission prompts, GPS indoors. These are in [[Open questions]].

## Screenshots for the README
`npm run screenshots` (or `STUB_TILES=1 node scripts/capture-walkthrough.mjs --no-build` offline) regenerates `docs/walkthrough/`. Redo it after visible UI changes.
