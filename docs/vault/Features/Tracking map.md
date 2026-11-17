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

Why not the `leaflet-rotate` plugin: see [[Decisions]].

Code: `src/components/TrackMap.jsx`, `SeekerView.jsx`, `CompassArrow.jsx`, `src/hooks/useCompassHeading.js`.
