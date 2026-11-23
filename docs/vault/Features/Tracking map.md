---
tags: [manhunt, feature]
---
# Tracking map

**Choosing a view.** Seekers tap a hider to track them, with the **Compass** (default) or the **Map**. Each phone remembers its choice (`manhunt.trackMode`).

**Compass.**
- The needle points at the hider, and the dial turns so N stays north.
- It's eased by a damped spring (`useSmoothAngle`, shared with the map).

**Map.**
- Shows you, a dashed line to the tracked hider, the other hiders (tap to switch) and the play area.
- It frames both of you once, then stays put while you pan; **Fit** reframes.

**Turning with the phone (Version 80; on request since 2026-11-22).** With the align button on, the map rotates so the way you face is up, like the dial. Leaflet can't rotate, so:
- the map is drawn on a square as wide as the view's diagonal, rotated with CSS (`--map-rotation`) and clipped to the view;
- pins, names and Leaflet's zoom and credit controls are counter-rotated to stay upright;
- `dragFollowsRotation` (`src/utils/leafletBase.js`) turns each drag back by the map's angle, so it follows the finger;
- pinch, wheel and double-tap zoom keep the centre;
- framing keeps both markers inside the circle that's visible at any angle;
- Without a compass reading (on computers) the map stays north up and the align button is hidden.

**The align button (2026-11-22).** The owner: "The align map button should align the map with the heading [of] the phone not align the map to north."
- Before, the map turned with the phone from the start, and the button under the crosshair (a needle) *kept north up*: pressing it aligned the map to north.
- Now **north is up until the button is pressed**. Pressed, the map turns to the phone's heading and follows it; the button is lit and shows a needle pointing to where north has gone. Pressed again, north is back up. Off, it shows a compass. Remembered per phone (`manhunt.mapTurns`; the old `manhunt.mapNorthUp` is no longer read).
- This reverses Version 80's default (turning from the start). It was the only way to make "the align button aligns to the heading" true: with the map already turned, the button had nothing to do but put north up.
- Centre on me (below) turns it on as well.

**Centre on me (2026-11-22).** The owner asked for "a center on me and align button" on all maps. A crosshair button between Fit and the align button, on the seeker's map and the hider's ([[Hider map]]):
- it puts you in the middle, at street zoom or closer if the map already was, and lines the map up with the way you face: it turns the align button on (and that is remembered);
- the map then **stays on you** as you walk, and the button stays lit. Zooming keeps it; dragging the map, **Fit**, or tracking another hider lets go. While it's on, Fit is highlighted as the way back to seeing everyone;
- "align" was read as *facing the way you face*, which the owner confirmed later the same day (the align button, above). Without a compass there's nothing to line up with and it only centres;
- the three buttons are one column (`.track-map-tools`) that takes no taps itself, only its buttons: the first version blocked dragging the map beside the narrow buttons, which the track-map suite caught;
- pressed **while the map is reframing** it used to do nothing for about a second. Leaflet drops a view asked for while a zoom is animating, and a slide started beside a zoom leaves the map a few pixels off. Now a centring asked for mid-zoom is kept until the zoom lands (`waitingCentreRef`), and any move that ends off you while the map is following is put right (`moveend` in `TrackMap.jsx`). The hider-map suite caught it, once the faster blur made the other hider's pin move at just that moment.

The play-area map in the game settings isn't changed: it already has **Centre on me** under it, and it never turns (corners are placed and dragged on it), so there is nothing to line up.

Why not the `leaflet-rotate` plugin: see [[Decisions]].

Code: `src/components/TrackMap.jsx`, `SeekerView.jsx`, `CompassArrow.jsx`, `src/hooks/useCompassHeading.js`.
