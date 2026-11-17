---
tags: [manhunt, feature]
---
# Steady hider positions

**The problem.** Indoors, GPS fixes scatter tens of metres.

**The fix.** On hiders' phones each fix passes through a small Kalman filter that weighs it by the accuracy the phone reports (`src/utils/positionFilter.js`, applied in `useGeolocation` with `smooth`).
- **Poor fixes** (indoors) are averaged over many. In a simulation a ~40 m scatter showed as ~8–11 m off and stopped jumping (68 m → ~2 m per update).
- **Good fixes** (outdoors) are followed almost at once. Walking out of a building shows within seconds, and a walking hider is shown within ~9 m.
- **One position everywhere.** The steadied position is what the hider sees, what's sent, and what the [[Found mechanic]] checks. Seekers' fixes are untouched.

**Limit.** Averaging removes jitter, not a building's steady offset (signals bouncing off walls). If real games still put hiders in the wrong room, the next step is the **selfie rule**: a hider who stays in one area while hunted sends a photo. See [[Decisions]] and [[Open questions]].
