---
tags: [manhunt, timeline]
---
# Timeline

Every commit on `main`, newest first. The **version** is the build number the landing page shows (the commit count), so you can match what a phone runs to what changed. Up to Version 83, the last commit before the [[Session handoff]] (the vault itself comes after it).

| Version | Commit | Date | Change |
|---|---|---|---|
| 83 | `8abb790` | 2026-11-17 | Add the browser tests to the repo: npm run test:e2e and audit:ui |
| 82 | `cde107c` | 2026-11-17 | Stop iPhones offering "Undo Typing" when shaken after typing |
| 81 | `3e88bd5` | 2026-11-17 | Line up the Required and Optional tags in the permission lists |
| 80 | `03d4668` | 2026-11-17 | Turn the seeker's map with the phone, like the compass dial |
| 79 | `30a1fc7` | 2026-11-17 | Remove the temporary test-notification button |
| 78 | `88db06e` | 2026-11-17 | Let the camera switch turn off, and open Settings with switches settled |
| 77 | `bc105dc` | 2026-11-17 | Show "Blocked" in red and "Asking…" in grey, with nothing more |
| 76 | `b1db80c` | 2026-11-17 | Drop the On/Off line under each permission switch |
| 75 | `1595d90` | 2026-11-17 | Add an optional camera switch to the installed app's popup and Settings |
| 74 | `b023199` | 2026-11-17 | Add a temporary test-notification button to the landing page |
| 73 | `2f5492c` | 2026-11-17 | List the required permissions before the optional ones |
| 72 | `f6cf4a4` | 2026-11-17 | Let optional permissions be turned off again |
| 71 | `a7136f0` | 2026-11-17 | Require the compass, and keep the permissions popups on screen |
| 70 | `9b153dc` | 2026-11-17 | Steady hiders' positions indoors by averaging fixes by their accuracy |
| 69 | `c480a21` | 2026-11-17 | Remind players away from the app before they're taken out of a lobby |
| 68 | `e30a8eb` | 2026-11-17 | Bring back "Before you play" on entering a lobby in the browser |
| 67 | `1fa9e68` | 2026-11-17 | Ask for permissions when they're needed, or once in the installed app |
| 66 | `66ef06c` | 2026-11-17 | Offer to add Manhunt to the Home Screen on the first visit |
| 65 | `a1ec7c9` | 2026-11-17 | Let the host choose what hiders learn about the seekers |
| 64 | `ad5bd51` | 2026-11-17 | Notify players when someone is found, even with the phone locked |
| 63 | `86d2b44` | 2026-11-17 | Hand over from app copies too old to apply updates themselves |
| 62 | `56b6ff5` | 2026-11-17 | Have installed apps check for updates and apply them safely |
| 61 | `883a0c4` | 2026-11-17 | Show the version on the landing page |
| 60 | `cb64839` | 2026-11-16 | Let seekers track hiders on a street map as well as the compass |
| 59 | `df37e7a` | 2026-11-16 | Let caught hiders declare themselves found; end the game when everyone is |
| 58 | `8f594df` | 2026-11-09 | Make the toolbar brand mark match the new app icon |
| 57 | `7891d68` | 2026-11-09 | Replace the app icon with the compass needle and fix dot |
| 56 | `86ee1bf` | 2026-11-09 | Line up text that sat out of place |
| 55 | `d8eb614` | 2026-11-09 | Bring text up to iOS sizes and WCAG AA contrast |
| 54 | `7e2fc56` | 2026-11-09 | Centre the landing intro between the toolbar and the cards |
| 53 | `c94cd50` | 2026-11-09 | Centre the landing page's two cards as one block |
| 52 | `c6d4c74` | 2026-11-09 | Scale up the UI text a step |
| 51 | `71978de` | 2026-11-09 | Top-align the landing page |
| 50 | `c976bcc` | 2026-11-09 | Stop iOS blurring the top of the app, and ease the compass |
| 49 | `91b161a` | 2026-11-09 | Drop the workers.dev address; serve through the quick tunnel only |
| 48 | `bfaf7b2` | 2026-11-09 | Serve everything through Cloudflare with a permanent workers.dev address |
| 47 | `96c0530` | 2026-11-09 | Say which token scope Vercel needs, and what the team search found |
| 46 | `e072725` | 2026-11-09 | Find the Vercel team that owns the store automatically |
| 45 | `7257212` | 2026-11-09 | Publish through Vercel's global-config API, with fallbacks |
| 44 | `4daee0e` | 2026-11-09 | Explain exactly why the Vercel site doesn't find the server |
| 43 | `5b2910a` | 2026-11-09 | Use Vercel Global Config, the new name for Edge Config |
| 42 | `a81cc1c` | 2026-11-09 | Host the site on Vercel with the server behind a Cloudflare quick tunnel |
| 41 | `aef8a3c` | 2026-11-09 | Support Cloudflare's free trycloudflare.com address in the server setup |
| 40 | `c4d4bd2` | 2026-11-09 | Add a one-command server setup with Cloudflare Tunnel |
| 39 | `53e7b86` | 2026-11-08 | Add Vercel config and a guide for hosting the frontend there |
| 38 | `b774454` | 2026-11-07 | Centre the play-area handles on the polygon's corners |
| 37 | `c7bbe1a` | 2026-11-07 | Add a UI walkthrough to the README |
| 36 | `0a3c08c` | 2026-11-07 | Draw the play area as a polygon on a map |
| 35 | `aa1fa01` | 2026-11-07 | Give the host real authority and add a pregame lobby with game settings |
| 34 | `cead2b8` | 2026-11-07 | Replace ngrok with Cloudflare Tunnel and add Raspberry Pi hosting |
| 33 | `3a13f76` | 2026-11-07 | Simplify the codebase and harden it against bad input and bad networks |
| 32 | `79916b8` | 2026-11-07 | Unslop the UI: night-field theme with a real compass dial |
| 31 | `b711189` | 2026-11-07 | Add the unslop design skill under .claude/skills |
| 30 | `960ba49` | 2026-11-07 | Resolve merge conflict markers left in index.css |
| 29 | `8be9363` | 2026-08-07 | Some more changes |
| 28 | `182eed9` | 2026-08-07 | Some changes |
| 27 | `934654d` | 2026-08-06 | Stop the Save button from resizing the name input |
| 26 | `be5a703` | 2026-08-06 | Some changes |
| 25 | `222cf57` | 2026-08-06 | Move Save inside the name input; stop shadows and safe areas clipping edges |
| 24 | `b5b1011` | 2026-08-06 | Move the "Your name" label out of the input and into its row |
| 23 | `15cc0e9` | 2026-08-06 | Make list rows and base containers statically sized |
| 22 | `582befc` | 2026-08-05 | Reduce lobby visual noise with a strict two-tier surface system |
| 21 | `6646079` | 2026-07-23 | Enlarge the UI and tie all scaling to one constant; harden device independence |
| 20 | `41eafcd` | 2026-07-21 | Enhance origin validation and improve UI components |
| 19 | `76232d8` | 2026-07-19 | Made some UI improvements |
| 18 | `f633d85` | 2026-07-18 | Merge branch 'main' of https://github.com/That-Coder-Guy/ManhuntApp |
| 17 | `c5ea1fb` | 2026-07-18 | Enhance UI with new glass effect styles and layout adjustments |
| 16 | `f8ef215` | 2026-07-17 | Fix toolbar glass buttons: round background to match border |
| 15 | `ed9988d` | 2026-07-17 | Restyle the UI as a liquid-glass Apple app |
| 14 | `cd8747f` | 2026-07-14 | Land compass fix, invites, ngrok tunnel, and the Ionic UI rebuild on main |
| 13 | `78dba3e` | 2026-07-10 | Rebuild networking for spotty connectivity: Socket.IO, presence, offline UX |
| 12 | `63b1bca` | 2025-11-07 | Refactored CSS styles for error and loading screens, enhancing visual consistency and user experience. Updated Lobby components to manage permissions and improve error handling, including the removal of the PlayerNotFound component and the addition of a PermissionsGate for better session management. |
| 11 | `37f532f` | 2025-11-07 | Refactored CSS styles for better organization and responsiveness, including updates to typography, button styles, and utility classes. Adjusted animations for smoother transitions in SeekerView and CompassArrow components. |
| 10 | `70bf433` | 2025-11-06 | Refactored CSS styles for improved layout and responsiveness across components. |
| 9 | `5dc8b5d` | 2025-10-26 | Made some changes |
| 8 | `3b05418` | 2025-10-23 | Refactored Lobby components to improve error handling and session management. Updated LobbyError message, removed unused components, and added session persistence with localStorage for better user experience. |
| 7 | `bd850b0` | 2025-10-22 | Implemented leave lobby functionality in LobbyFound component, including API call on page unload and a dedicated Leave Lobby button for improved user experience. |
| 6 | `b01af72` | 2025-10-21 | Enhanced LobbyFound component with role-specific views for Seeker and Hider, and improved PlayerTable styling for better UI consistency. |
| 5 | `d204a05` | 2025-10-21 | Added role toggle switch |
| 4 | `9f4b358` | 2025-10-20 | Refactored LobbyFound component to enhance player data management and introduced PlayerNameEditor and PlayerTable components for improved UI and functionality |
| 3 | `f393be5` | 2025-10-20 | Refactored LobbyFound component to utilize lobby connection and player data state |
| 2 | `46dc396` | 2025-10-19 | Refactored Lobby component to improve join logic and state management |
| 1 | `77d7ce1` | 2025-10-19 | new react project |
