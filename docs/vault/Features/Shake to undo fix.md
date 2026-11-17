---
tags: [manhunt, feature]
---
# Shake to undo fix

**The problem.** iOS offers **Undo Typing** when the phone is shaken, for any typing left in the page's undo history, even long after the field was left. Running in a game shook it up constantly.

**What doesn't work.** Setting a field's value: WebKit doesn't clear the history for that (checked in WebKit's source).

**What does.** Closing a frame. Removing an iframe runs `FrameLoader::detachFromParent → closeURL → Editor::clearUndoRedoOperations`, which empties the whole page's undo list.

**The fix.** On iPhones and iPads, leaving a text field opens and closes a tiny empty iframe (`src/utils/noShakeUndo.js`).
- Undo still works while typing.
- Other devices are left alone.

**Still to confirm.** It couldn't be tested on a real iPhone ([[Open questions]]).
