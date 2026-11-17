// Loaded into the service worker (vite.config.js → workbox.importScripts).
//
// A new version normally waits until the app says it's a good moment
// (src/utils/appUpdate.js), so an update never reloads a phone mid-game. But
// a page running an app from before that (version 61 or older) can never say
// so, and reloading doesn't release a waiting worker, so it would stay on its
// old copy for good. So on install, every open page is asked whether it can
// apply updates itself; if any doesn't answer, this version takes over at once
// (clientsClaim is on) and that page's next reload or launch is the new app.
// It's a one-time handover: from then on, every page answers.

const ASK = 'MANHUNT_CAN_APPLY_UPDATES';
const ANSWER_WITHIN_MS = 1500;

function canApplyUpdates(page)
{
    return new Promise((resolve) =>
    {
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(false), ANSWER_WITHIN_MS);
        channel.port1.onmessage = () =>
        {
            clearTimeout(timer);
            resolve(true);
        };
        page.postMessage({ type: ASK }, [channel.port2]);
    });
}

self.addEventListener('install', (event) =>
{
    event.waitUntil((async () =>
    {
        const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const answers = await Promise.all(pages.map(canApplyUpdates));
        if (answers.includes(false)) await self.skipWaiting();
    })());
});
