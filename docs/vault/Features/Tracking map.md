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

**Turning with the phone (Version 80).** The map rotates so the way you face is up, like the dial. Leaflet can't rotate, so:
- the map is drawn on a square as wide as the view's diagonal, rotated with CSS (`--map-rotation`) and clipped to the view;
- pins, names and Leaflet's zoom and credit controls are counter-rotated to stay upright;
- `dragFollowsRotation` (`src/utils/leafletBase.js`) turns each drag back by the map's angle, so it follows the finger;
- pinch, wheel and double-tap zoom keep the centre;
- framing keeps both markers inside the circle that's visible at any angle;
- a **north button** under Fit keeps north up instead (`manhunt.mapNorthUp`). Without a compass reading (on computers) the map stays north up and the button is hidden.

**Centre on me (2026-11-22).** The owner asked for "a center on me and align button" on all maps. A crosshair button between Fit and the north button, on the seeker's map and the hider's ([[Hider map]]):
- it puts you in the middle, at street zoom or closer if the map already was, and lines the map up with the way you face: if north was being kept up, that's let go (and remembered as let go);
- the map then **stays on you** as you walk, and the button stays lit. Zooming keeps it; dragging the map, **Fit**, or tracking another hider lets go. While it's on, Fit is highlighted as the way back to seeing everyone;
- "align" was read as *facing the way you face*, the map's own default, not as north up, which the north button already does. Without a compass there's nothing to line up with and it only centres;
- the three buttons are one column (`.track-map-tools`) that takes no taps itself, only its buttons: the first version blocked dragging the map beside the narrow buttons, which the track-map suite caught.

The play-area map in the game settings isn't changed: it already has **Centre on me** under it, and it never turns (corners are placed and dragged on it), so there is nothing to line up.

Why not the `leaflet-rotate` plugin: see [[Decisions]].

Code: `src/components/TrackMap.jsx`, `SeekerView.jsx`, `CompassArrow.jsx`, `src/hooks/useCompassHeading.js`.
