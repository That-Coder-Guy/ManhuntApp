---
tags: [manhunt, feature]
---
# Hider position blur

How exactly seekers see a hider depends on how fast the hider is moving. Standing still, a hider is only shown as *somewhere within 100 m* of a point; the radius shrinks as they speed up, and from walking pace seekers see the exact spot. Added 2026-11-21: the owner found exact positions "too powerful when they are stationary", acceptable when moving, and asked for an ambiguity radius "inversely related to speed".

## The rule
| Hider's speed | Radius seekers get |
|---|---|
| under 0.3 m/s (still) | the lobby's full radius (100 m by default) |
| 0.3 to 0.6 m/s | half of it |
| 0.6 to 1.2 m/s | a quarter |
| 1.2 m/s and up (walking pace) | none: the exact position |

- The radius halves each time the speed doubles: that is the inverse relation, taken in steps (why steps: below).
- **Speed** is worked out on the server from the positions the phone sends: the net distance covered over the last 30 s and over the last 10 s, and the *lower* of the two. So it takes about half a minute of real walking to be shown exactly, about ten seconds of standing to be vague again, and GPS wobble on the spot (which covers no net distance) reads as still. The phone's own speed reading isn't used: a hider's phone could lie about it.
- A step changes only once the speed is 15% past its threshold, so a speed hovering at one doesn't flip the radius.
- The speed is worked out when the lobby state goes out, which is when something happens. So that a hider who stops, with a phone that then sends nothing, doesn't stay shown exactly, the server looks again every 5 s while any hider is being shown more exactly than a still one (`recheckMovingHiders`, `blurRecheckMs`). The first browser test caught this.

## The host's setting
**Seekers see → A still hider**: *Exactly*, or *Within* 50, 100 (default), 150, 200 or 300 m. One row and one line of explanation. The server takes 0 or 20 to 500 (`hider_blur_m`). The lobby's summary row mentions it only when it isn't the default.

## What each side sees
- **Seekers:** the row reads `≈ 120 m` and `±100 m · 5s ago`; the compass readout the same; the map draws the area as a circle round the pin. The arrow, the distance and the dashed line go to the middle of the area.
- **Hiders:** a line at the foot of their *Seekers* card: *Seekers see you within 100 m*, or *Moving · seekers see exactly where you are*. Staying vague is theirs to manage.
- Finding, the found range and what hiders see of seekers all still use real positions. So does the out-of-bounds flag: seekers are told who is outside the play area however vague the position.
- [[Jamming]]: a jam freezes what the seekers were being told, which for a still hider is already the vague point.
- Other hiders get the same vague point as the seekers ([[Hider map]]), so a hider who is caught knows no more than the seekers did.

## Why it is a grid of squares, and steps, not a fuzzy point
Enforced on the server (`seenPosition` in `server/server.js`, the *How exactly seekers see a hider* part of `server/game.js`): a seeker's phone never receives a slow hider's real position. The obvious way to do that, a random point near the hider that follows them, gives the position away:
- a point re-drawn each update can be **averaged** back to the real one;
- a fixed offset that scales with a smoothly changing radius can be **extrapolated**: two readings give the direction and the real position exactly.

So what seekers get is the centre of a fixed square on a grid:
- While a hider stays in their square, its centre is all the seekers ever see, however the hider's position wobbles.
- The grids for the three radii are nested (each step's squares split the last one's in four), so a change of step never narrows things further than the finest square already shown.
- Where the grid lies is random and different for each hider and each game, so two hiders together don't show at one point and the squares' edges can't be learned.
- A hider stays in their square until 15% of its side outside it, so standing on an edge doesn't flicker between two squares and give the edge away. The square is sized so that even then the hider is within the stated radius of the centre.

## What it does not hide
- **Where a hider stopped.** While they walk, seekers see them exactly, so a seeker who watches a hider walk somewhere and stop has seen roughly where. The blur protects a hider who was already still when the seekers were released (after a head start), who arrived under a jam, who creeps slowly, or whom nobody was watching. Showing a moving hider's position a few seconds late would narrow this gap; it wasn't asked for and isn't done.
- Crossing from one square to the next shows the seekers that the hider is near that edge, at that moment.

## Not done, not checked
- Untested on real phones. The thresholds (0.3 / 0.6 / 1.2 m/s, the 30 s and 10 s look-backs) are first guesses that real GPS may want tuned; they are in `BLUR` in `server/game.js`.
- Checked by `tests/blur.test.js`, two tests in `tests/server.test.js` and `tests/e2e/suites/hider-blur.mjs`. The older suites that are about something else set the lobby to *Exactly*.

Code: `server/game.js` (`BLUR`, `hiderSpeed`, `nextBlurShare`, `blurredPosition`), `server/server.js` (`seenPosition`, `recordFix`), `PlayerRow`, `TargetReadout`, `TrackMap`, `HiderView`, the *Seekers see* section of `SettingsSheet.jsx`.
