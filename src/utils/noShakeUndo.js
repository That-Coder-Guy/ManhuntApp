// iPhones and iPads offer "Undo Typing" when shaken, for any typing still in
// the page's undo history, even long after the field was left. Running
// around in a game shakes the phone, so that popup kept appearing.
//
// A page can't turn the gesture off, and changing a field's value doesn't
// clear the history either. What does, in Safari's engine, is a frame
// closing: removing an iframe runs FrameLoader::detachFromParent →
// closeURL → Editor::clearUndoRedoOperations, which empties the whole
// page's undo list (WebEditorClient::clearUndoRedoOperations). So once a
// text field loses focus, a tiny empty iframe is added and removed straight
// away, and a shake has nothing left to undo. While typing, undo still works.
import { isIOS } from './install';

const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', '']);

const isTextField = (el) => el instanceof HTMLTextAreaElement
    || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type));

/** Empty the page's undo history (Safari): open and close an empty frame */
export function forgetTyping()
{
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(frame);
    frame.remove();
}

/** Clear the undo history whenever a text field is left (once, at start-up) */
export function initNoShakeUndo()
{
    if (typeof document === 'undefined' || !isIOS()) return;
    document.addEventListener('focusout', (event) =>
    {
        if (!isTextField(event.target)) return;
        // After the blur has finished: if focus moved to another field, its
        // typing starts afresh anyway
        setTimeout(forgetTyping, 0);
    }, true);
}
