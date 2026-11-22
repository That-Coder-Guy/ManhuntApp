---
tags: [manhunt, feature]
---
# Hider map

Hiders can see each other on a map, as the seekers see them, and on a seeker's map every seeker is one colour. Added 2026-11-21: the owner asked that "hiders should be able to see each other in map mode" and "all seekers should be the same color".

## The hider's screen
A **Seekers / Map** switch sits above the hider's main card; the choice is remembered on the phone (`manhunt.hiderMode`).
- **Seekers** is the card there always was: what the host lets hiders know about the seekers ([[Hider seeker info]]).
- **Map** shows the hider ("You") and every fellow hider as a named pin, and the play area. It frames everyone, and frames again when a hider appears or leaves. A line under it says "You and 2 other hiders · seekers aren't shown". The crosshair button centres it on you and keeps it there ([[Tracking map]], "Centre on me"); a hider appearing or leaving doesn't take it off you.
- **No seeker is on a hider's map.** Their positions never reach a hider's phone; that rule ([[Decisions]]) is unchanged.

## Hiders see each other as the seekers do, and no better
- During a game a hider's copy of the lobby state carries, for each other hider, **exactly what the seekers' copy carries** (`viewFor` in `server/server.js`): the vague point and its radius while they are still ([[Hider position blur]]), the frozen point while they jam ([[Jamming]]), nothing during the head start. Their own position is the only real one a hider has.
- **Why not their real positions.** A hider who is caught joins the seekers. The first version sent hiders each other's exact positions, and the owner saw the problem the same day: "in case they get caught". With the seekers' copy, a caught hider arrives knowing nothing the seekers didn't already have. Don't make it exact again without that being asked for.
- The owner was offered three options (the seekers' view, exact, no hider map) and chose the seekers' view.

## One colour for seekers
- On a seeker's map the other seekers are now drawn (they weren't): dots in the same blaze orange as "you", a little smaller, with the name on a tap. Hiders stay discs with initials. So the two sides never look alike.
- The owner's sentence had no map to refer to that showed several seekers, so drawing the other seekers on the seeker's map, all in one colour, was my reading of it.

## Checks
`tests/e2e/suites/hider-map.mjs`, and two tests in `tests/server.test.js` (a hider never gets a seeker's position; of another hider they get what the seeker gets, through the head start, a jam and being found). Not tried on real phones.

## Found while building it
The map was created before its container had its real size, so a first framing could come out zoomed far too wide (pins on top of each other) until **Fit** was tapped. `TrackMap` now sizes its square before making the Leaflet map.

Code: `HiderView.jsx`, `TrackMap.jsx` (`youAre`, `seekers`, a null `target`), `SeekerView.jsx`.
