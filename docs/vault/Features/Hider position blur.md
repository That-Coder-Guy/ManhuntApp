---
tags: [manhunt, feature]
---
# Hider position blur

How exactly seekers see a hider depends on how fast the hider is moving. Standing still, a hider is only shown as *somewhere within 25 m* of a point; the radius shrinks as they speed up, and faster than an 11-minute mile seekers see the exact spot. Added 2026-11-21: the owner found exact positions "too powerful when they are stationary", acceptable when moving, and asked for an ambiguity radius "inversely related to speed". Reworked 2026-11-22 (below).

## The rule
| Hider's speed | Radius seekers get |
|---|---|
| under 0.61 m/s (still, or shuffling) | the lobby's full radius (25 m by default) |
| 0.61 to 1.22 m/s (a stroll) | half of it |
| 1.22 to 2.44 m/s (a walk) | a quarter |
| over 2.44 m/s (faster than an 11-minute mile) | none: the exact position |

- **The 11-minute mile is the owner's line** (2026-11-22): "if a hider is moving faster than 11 minute mile than the ambiguity radius should be fully zeroed in". The radius halves each time the speed doubles below it: that is the inverse relation, taken in steps (why steps: below).
- **Speed** is worked out on the server from the positions the phone sends: the net distance covered, over the time between the fixes used. The phone's own speed reading isn't used: a hider's phone could lie about it.
  - The **exact** pace is judged over the last 6 s alone (`exact_window_ms`), so a hider who breaks into a run is exact within seconds. Nothing standing still reads as a run.
  - The **smaller steps** go by the lower of the last 15 s and the last 5 s. GPS wobble on the spot can pass for a stroll over a few seconds, and must not shrink a still hider's circle; over 15 s it covers too little ground. Five seconds of standing is enough to be vague again.
- Reaching a threshold counts at once (no margin on top of the 11-minute mile). Going back to a vaguer step needs the speed to fall 15% under the threshold, so a speed hovering at one doesn't flip the radius.
- The speed is worked out when the lobby state goes out, which is when something happens. So that a hider who stops, with a phone that then sends nothing, doesn't stay shown exactly, the server looks again every 5 s while any hider is being shown more exactly than a still one (`recheckMovingHiders`, `blurRecheckMs`). The first browser test caught this.

## The host's setting
**Seekers see → A still hider**: *Exactly*, or *Within* 25 (default), 50, 100, 150, 200 or 300 m. One row and one line of explanation. The server takes 0 or 20 to 500 (`hider_blur_m`). The lobby's summary row mentions it only when it isn't the default.

## What each side sees
- **Seekers:** the row reads `≈ 120 m` and `±25 m · 5s ago`; the compass readout the same; the map draws the area as a circle round the pin. The arrow, the distance and the dashed line go to the middle of the area. The figure is rounded up (a quarter of 25 m shows as ±7 m), so "within" is always true.
- **Hiders:** a line at the foot of their *Seekers* card: *Seekers see you within 25 m*, or *Moving · seekers see exactly where you are*. Staying vague is theirs to manage.
- Finding, the found range and what hiders see of seekers all still use real positions. So does the out-of-bounds flag: seekers are told who is outside the play area however vague the position.
- [[Jamming]]: a jam takes the hider away altogether, vague point and all. When it ends they are shown again by the same rule: in the circle they were in, if they haven't left it.
- Other hiders get the same vague point as the seekers ([[Hider map]]), so a hider who is caught knows no more than the seekers did.

## Why it is a circle that stays put, and steps, not a fuzzy point
Enforced on the server (`seenPosition` in `server/server.js`, the *How exactly seekers see a hider* part of `server/game.js`): a seeker's phone never receives a slow hider's real position. The obvious way to do that, a random point near the hider that follows them, gives the position away:
- a point re-drawn each update can be **averaged** back to the real one;
- a fixed offset that scales with a smoothly changing radius can be **extrapolated**: two readings give the direction and the real position exactly.

So what seekers get is the centre of a circle that doesn't move while the hider is in it (`blurredPosition`):
- A new circle is put down **at random around the hider**, evenly by area, so the hider may be anywhere in it. (The owner, 2026-11-22: the hider should be able to be "anywhere within that radius not just within the inner square". The first version used a grid of squares, each inside its circle, so a hider was only ever in the middle 64% of the circle drawn.)
- While the hider stays in the circle, its centre is all the seekers ever see, however the hider's position wobbles. Only walking out of it gets a new one.
- A new circle is put down with the hider at least 13% of the radius inside its edge (`margin`), so a little wobble where it was put down doesn't carry them straight out again. Every fresh circle is a fresh clue (the hider is in all of them), so they must be rare.
- When the step changes and the hider is still in the circle shown, the new one lies **inside it** (smaller) or **holds all of it** (larger): laying one over the other tells seekers nothing.
- The last circle of each size is kept on the player (`blur.circles`) and shown again while the hider is still in it. A speed that goes back and forth between two steps gets the same two circles each time, not a new one whose overlap with the last would close in.

## 2026-11-22: what changed, and why
The owner, watching the [[Simulator]]: hiders "move pretty fast but the ambiguity radius does not zero in on them like it should"; the default should be 25 m; and the circle point above.
- **It really didn't zero in.** Replaying the simulator's movement through the rule: a walking hider was shown exactly 29% of the time, a running one 50%. Exact needed 1.41 m/s (1.2 plus the 15% margin) of *net* ground covered over a full 30 s, and the simulator's walkers wandered.
- Now: the 11-minute mile, no margin on top, judged over 6 s. In the simulator a hider is exact 5 to 7 s after starting to run. A walk is never exact (a quarter of the radius).
- The simulator's walkers turn less (people follow paths), and its runs are faster than the line and longer.
- The speed is now divided by the time between the two fixes used, not by the window's length: with a fix every 2 s the older fix can be well over a window ago, which read as up to 40% too fast.

## What it does not hide
- **Where a hider stopped.** While they run, seekers see them exactly, and while they walk, to within a quarter of the radius, so a seeker who watches a hider go somewhere and stop has seen roughly where. The blur protects a hider who was already still when the seekers were released (after a head start), who arrived under a jam, who creeps slowly, or whom nobody was watching. Showing a moving hider's position a few seconds late would narrow this gap; it wasn't asked for and isn't done.
- Walking out of a circle shows the seekers that the hider was at its edge, at that moment, and is somewhere in the new one.
- At 25 m the smallest circle is 6 m across its radius, about what a phone's GPS is good for anyway.

## Not done, not checked
- Untested on real phones. The exact pace is the owner's; the two steps under it and the look-backs (15 s, 5 s, 6 s) are guesses that real GPS may want tuned. They are in `BLUR` in `server/game.js`.
- Checked by `tests/blur.test.js`, two tests in `tests/server.test.js` and `tests/e2e/suites/hider-blur.mjs`. The older suites that are about something else set the lobby to *Exactly*.

Code: `server/game.js` (`BLUR`, `hiderSpeed`, `nextBlurShare`, `blurredPosition`), `server/server.js` (`seenPosition`, `recordFix`), `PlayerRow`, `TargetReadout`, `TrackMap`, `HiderView`, the *Seekers see* section of `SettingsSheet.jsx`.
