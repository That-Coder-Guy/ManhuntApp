---
tags: [manhunt, feature]
---
# Hider seeker info

The host's **Hiders see** setting decides what hiders learn about the seekers during a game:

| Mode | Hiders see |
|---|---|
| **Distance** (default) | The distance to the nearest seeker, not who or which way. Red under 100 m |
| **Nearby alert** | Only *Seeker nearby* or *All clear*, against a radius that is never more than the found range (so 50 m at the defaults). Android buzzes when a seeker comes in |
| **Nothing** | No seeker information |

**The alert never reaches further than the found range (2026-11-22).** The owner: the "hider notification radius is always smaller or the same size as the 'I've been found' radius", needed only where "hiders can only see if the closest seeker is within a certain radius".
- So it applies in **Nearby alert** mode alone. There the alert distance is brought down to the found range whichever of the two the host changes (`applySettings` in `server/game.js`); `seekerInfoFor` holds to it as well, for settings that never went through that.
- It is held down, not rewritten to a refusal: asking for 300 m with the range at 50 saves 50, and lowering the range lowers the alert with it. Saving never fails over it.
- In the other two modes the alert distance isn't used and is left as it was (its default is still 100 m); it is brought down when the mode is switched to Nearby alert.
- The settings sheet offers only distances up to the found range (10 m upwards now, where the menu began at 25), shows a longer stored one as the range, and its note says so. Putting the range back up shows the stored distance again.
- What it means in play: when *Seeker nearby* shows, the seeker is already close enough for the hider to be found.

**Enforced on the server.**
- During a game each player gets their own copy of the lobby state. A hider's copy has no seeker's coordinates, only a `seeker_info` worked out for them. (Since 2026-11-21 it does carry the other hiders, as the seekers see them: [[Hider map]].) (`seekerInfoFor` in `server/game.js`, `viewFor` in `server.js`).
- Seekers still see all hiders.

**How it ties in with finding.**
- In *nearby* and *nothing* modes the **Found** button is always tappable, and the server checks the range.
- Known gap: tapping it repeatedly could be used to probe ([[Open questions]]). See [[Found mechanic]].

Code: `src/components/HiderView.jsx`, the *Hiders see* section of `SettingsSheet.jsx`.
