---
tags: [manhunt, feature]
---
# Hider seeker info

The host's **Hiders see** setting decides what hiders learn about the seekers during a game:

| Mode | Hiders see |
|---|---|
| **Distance** (default) | The distance to the nearest seeker, not who or which way. Red under 100 m |
| **Nearby alert** | Only *Seeker nearby* or *All clear*, against a radius (25–500 m in the menu, default 100 m). Android buzzes when a seeker comes in |
| **Nothing** | No seeker information |

**Enforced on the server.**
- During a game each player gets their own copy of the lobby state. A hider's copy has no one else's coordinates, only a `seeker_info` worked out for them (`seekerInfoFor` in `server/game.js`, `viewFor` in `server.js`).
- Seekers still see all hiders.

**How it ties in with finding.**
- In *nearby* and *nothing* modes the **Found** button is always tappable, and the server checks the range.
- Known gap: tapping it repeatedly could be used to probe ([[Open questions]]). See [[Found mechanic]].

Code: `src/components/HiderView.jsx`, the *Hiders see* section of `SettingsSheet.jsx`.
