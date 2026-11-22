---
tags: [manhunt, feature]
---
# Jamming

A hider can **jam** the seekers' tracking of them. For the length of the jam the seekers keep the position that hider had when it started, marked **Jammed**; when it ends they get the real one back. Added 2026-11-21 at the owner's request.

## The host's settings
One **Jamming** section at the foot of the game settings sheet:

| Setting | Default | In the menu | Server accepts |
|---|---|---|---|
| **Hiders can jam** | on | a switch | true / false |
| **Jam lasts** | 60 s (shown as "1 min") | 15 s to 5 min | 10 s to 10 min |
| **Charge time** | 15 min | 1 to 60 min | 10 s to 60 min |

- The owner asked for the settings page to stay clean: turned off, the two times aren't shown at all, only the switch and one line.
- The lobby's summary row mentions jamming only when it differs from the defaults ("30 s jam, 5 min charge", or "No jamming").
- The server accepts shorter times than the menu offers so the browser test needn't wait fifteen minutes.

## How it plays
- **Charging.** A jammer starts empty. It charges from the moment the seekers set off (the head start doesn't count), and again for the full charge time from the *end* of each jam.
- **One per hider.** Each hider has their own jammer, and a jam hides only the hider who starts it; every other hider is tracked as ever. The owner confirmed this is what they want (2026-11-21), so don't make one jam hide everyone.
- **The hider** has a *Jammer* card under the game clock: *Charging · ready in 12:34*, *Ready · hides you for 1 min* with a **Jam** button, then *Hidden from seekers · 0:42 left*. One tap, no confirmation. With jamming off there is no card.
- **The seekers** get a notice ("Maya is jamming your tracking"). Her row, the compass readout and her map pin show her as *Jammed · last seen 17s ago* and stale; the distance and direction are to where she was. They aren't shown how long is left.
- **Being found** ends a jam at once. A hider made a seeker and back, or one who joins part-way through, starts charging from that moment.
- Finding, the found range and what hiders see of the seekers ([[Hider seeker info]], [[Found mechanic]]) all use real positions and aren't affected.

## Enforced on the server
- The frozen position is the server's doing: while a jam runs, the copy of the lobby state that everyone else gets carries the hider's position, its age and its inside/outside-the-play-area flag from when the jam started (`publicPlayerData` in `server/server.js`). A seeker's phone never has the real one.
- The hider's own copy keeps their real position, and carries `jam` (`jamStatus` in `server/game.js`): whether it's on, the times, when it's ready and when a running jam ends. The phone works the state out from those times with the server's clock (`jamView` in `src/utils/game.js`), so the countdowns move between updates.
- The `jam` event is refused with `charging`, `already_jamming`, `jam_off`, `not_a_hider`, `head_start` or `wrong_phase`. A timer on the server pushes the real position out the moment a jam ends.

## Not done
- No push notification to a seeker whose phone is locked when a jam starts.
- The seekers don't see how long a jam has left.
- Untested on real phones; checked in the browser tests only (`tests/e2e/suites/jam.mjs`, `tests/jam.test.js`, and two tests in `tests/server.test.js`).

Code: `server/game.js` (`jamStatus`), `server/server.js` (`startJam`, the `jam` event), `JamCard` in `src/components/GamePanels.jsx`, the *Jamming* section of `SettingsSheet.jsx`, `playerFreshness` in `src/utils/players.js`.
