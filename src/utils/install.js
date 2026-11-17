// Offering to install the app (to the Home Screen), once, on the first visit.
//
// Installed, Manhunt opens full screen like an app, and on an iPhone that's
// the only way it can get notifications. How to install depends on the
// browser: Chrome and Edge can show their own install prompt; on an iPhone
// it's Share → Add to Home Screen; other Android browsers have it in their
// menu. A browser that can't install it isn't asked.
import { useSyncExternalStore } from 'react';

const OFFERED_KEY = 'manhunt.installOffered';
// Chrome's install prompt can come a moment after the page loads
const WAIT_FOR_PROMPT_MS = 1500;

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

let deferredPrompt = null;
// 'pending' while deciding on a first visit, 'open' while showing, 'done' after
let state = { status: 'pending', kind: null };
const listeners = new Set();

function set(next)
{
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
}

const storage = {
    get: () => { try { return localStorage.getItem(OFFERED_KEY); } catch { return '1'; } },
    set: () => { try { localStorage.setItem(OFFERED_KEY, '1'); } catch { /* private mode: ask again next time */ } }
};

/** How this browser installs: 'prompt' | 'ios' | 'menu', or null if it can't */
function installKind()
{
    if (deferredPrompt) return 'prompt';
    if (isIOS()) return 'ios';
    if (isAndroid()) return 'menu';
    return null;
}

/** Start listening for the browser's install prompt and decide whether to offer (once, at start-up) */
export function initInstallOffer()
{
    if (typeof window === 'undefined') return;

    window.addEventListener('beforeinstallprompt', (event) =>
    {
        // Keep it for our own button instead of the browser's mini-bar
        event.preventDefault();
        deferredPrompt = event;
        if (state.status === 'open') set({ kind: 'prompt' });
    });
    window.addEventListener('appinstalled', () =>
    {
        deferredPrompt = null;
        if (state.status === 'open') set({ status: 'done' });
    });

    if (isInstalled() || storage.get()) return set({ status: 'done' });

    setTimeout(() =>
    {
        const kind = installKind();
        if (!kind) return set({ status: 'done' });
        storage.set();
        set({ status: 'open', kind });
    }, WAIT_FOR_PROMPT_MS);
}

/** Close the offer */
export function dismissInstallOffer()
{
    set({ status: 'done' });
}

/** Show the browser's own install prompt (Chrome, Edge), then close the offer */
export async function installApp()
{
    const prompt = deferredPrompt;
    deferredPrompt = null;
    dismissInstallOffer();
    if (!prompt) return;
    try {
        await prompt.prompt();
    } catch { /* already used, or the browser refused */ }
}

const subscribe = (listener) =>
{
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** { status: 'pending' | 'open' | 'done', kind } */
export function useInstallOffer()
{
    return useSyncExternalStore(subscribe, () => state, () => state);
}
