// Keeping an installed app up to date.
//
// The service worker serves the app offline. When a new version is deployed,
// the browser installs its new worker in the background, but the screen keeps
// running the old copy until the page reloads, and an installed app resumed
// from the background (on iOS especially) may not reload for days. So the app
// looks for an update when it starts, whenever it comes back to the screen,
// and every half hour; a new version then waits ("update ready") until the
// app applies it at a safe moment, never in the middle of a game.
import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

const CHECK_EVERY_MS = 30 * 60 * 1000;
// Coming back to the app checks again, but not more often than this
const MIN_GAP_MS = 60 * 1000;

let updateReady = false;
let apply = null;
const listeners = new Set();

function setReady()
{
    updateReady = true;
    listeners.forEach((listener) => listener());
}

/** Register the service worker and start looking for updates (once, at start-up) */
export function initAppUpdates()
{
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    apply = registerSW({
        immediate: true,
        onNeedRefresh: setReady,
        onRegisteredSW(_url, registration)
        {
            if (!registration) return;
            let lastCheck = Date.now();
            const check = () =>
            {
                if (!navigator.onLine || Date.now() - lastCheck < MIN_GAP_MS) return;
                lastCheck = Date.now();
                registration.update().catch(() => { /* offline or server down: try again later */ });
            };
            setInterval(check, CHECK_EVERY_MS);
            document.addEventListener('visibilitychange', () =>
            {
                if (document.visibilityState === 'visible') check();
            });
        }
    });
}

/** Switch to the new version: the page reloads into it */
export function applyAppUpdate()
{
    apply?.(true);
    // The worker hand-over normally triggers the reload; if it hasn't
    // happened shortly, reload anyway so the app can't get stuck
    setTimeout(() => window.location.reload(), 3000);
}

const subscribe = (listener) =>
{
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** True once a new version has downloaded and is waiting to be applied */
export function useUpdateReady()
{
    return useSyncExternalStore(subscribe, () => updateReady, () => false);
}
