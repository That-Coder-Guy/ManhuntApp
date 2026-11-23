---
tags: [manhunt, feature]
---
# Jamming

A hider can **jam** the seekers' tracking of them. For the length of the jam that hider **vanishes** for the seekers: off their list, their compass and their map, with no position sent at all. When it ends they are back. (Until 2026-11-22 a jam *froze* what the seekers saw: they kept the position from when it started, marked "Jammed · last seen 17s ago". The owner: "jamming seekers as a hider should make you completely disappear from the perspective of the seekers".) Added 2026-11-21 at the owner's request.

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
- **The hider** has an **Abilities** button on the game screen, under the clock, which opens a menu, *Hider abilities*, with the *Jammer* in it: *Charging · ready in 12:34*, *Ready · hides you for 1 min* with a **Jam** button, then *Hidden from seekers · 0:42 left*. One tap on Jam, no confirmation, and the menu stays open so the hider sees it take. (Until 2026-11-22 the jammer was a card on the game screen, under the clock. The owner asked to "move the hider jam ability under an 'Abilities' menu or maybe a 'Role Abilities' menu", and then that it "should be under a button in the main UI": the first version put the button in the toolbar.)
  - The button says how the jammer stands without being opened: *Jammer charging · 12:34*, *Jammer ready*, *Jamming · 0:42 left*, lit when ready or running.
  - While a jam runs, the hider's *Seekers* card says *Jamming · hidden from seekers for 0:42*, where the line about how they are seen usually is: with the jammer out of sight, the screen still has to say they are hidden.
  - It costs a tap more to jam than the card did. If that proves too slow with a seeker closing in, the button could jam on a long press.
  - Seekers have no abilities yet, so no button. The menu is where a second ability, for either side, would go (`AbilitiesMenu` in `GamePanels.jsx`). With jamming off there is no card.
- **The seekers** get a notice ("Maya is jamming: gone from your tracking"), and she is gone: no row in their list of hiders, no pin or circle on the map. A seeker who was tracking her is put back on the list, and stays there when she comes back (they pick her again; being thrown back onto her compass was the first version, and felt like the app acting by itself). With every hider jamming the list reads "No hider can be tracked right now". They aren't shown how long is left.
- **The notice stays.** "Completely disappear" was read as *no trace of where*, not *no sign that it happened*: without it a seeker would take a hider dropping off the list for a fault. It is one line to remove if the owner wants jams silent.
- **The lobby's list of players** (the people button) still has her, marked *Jamming*: she hasn't left the game, and the host must still be able to manage her.
- **Fellow hiders** lose her from their map too, as they get exactly what the seekers get ([[Hider map]]).
- **Being found** ends a jam at once. A hider made a seeker and back, or one who joins part-way through, starts charging from that moment.
- Finding, the found range and what hiders see of the seekers ([[Hider seeker info]], [[Found mechanic]]) all use real positions and aren't affected.

## Enforced on the server
- Vanishing is the server's doing: while a jam runs, the copy of the lobby state that everyone else gets has no position for that hider, real, vague or old, and none of what goes with one (its age, its radius, the inside/outside-the-play-area flag): only `jammed_until` (`publicPlayerData` in `server/server.js`). A seeker's phone has nothing to show, whatever it does. The server test checks that neither her old position nor her new one appears anywhere in what a seeker is sent.
- The hider's own copy keeps their real position, and carries `jam` (`jamStatus` in `server/game.js`): whether it's on, the times, when it's ready and when a running jam ends. The phone works the state out from those times with the server's clock (`jamView` in `src/utils/game.js`), so the countdowns move between updates.
- The `jam` event is refused with `charging`, `already_jamming`, `jam_off`, `not_a_hider`, `head_start` or `wrong_phase`. A timer on the server sends the lobby state the moment a jam ends, which puts the hider back.

## Not done
- No push notification to a seeker whose phone is locked when a jam starts.
- The seekers don't see how long a jam has left.
- Untested on real phones; checked in the browser tests only (`tests/e2e/suites/jam.mjs`, `tests/jam.test.js`, and two tests in `tests/server.test.js`).

Code: `server/game.js` (`jamStatus`), `server/server.js` (`startJam`, the `jam` event), `AbilitiesMenu` and `JamCard` in `src/components/GamePanels.jsx`, the *Jamming* section of `SettingsSheet.jsx`, `playerFreshness` in `src/utils/players.js`.
