// Loaded into the service worker (vite.config.js → workbox.importScripts).
//
// Shows the server's push notifications ("Maya was found"). iOS wakes the
// worker just long enough for this, and every push must show a notification.
// Tapping one brings the app up on that lobby.

self.addEventListener('push', (event) =>
{
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { body: event.data?.text() };
    }
    event.waitUntil(self.registration.showNotification(data.title || 'Manhunt', {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        // One notice per lobby: a newer one replaces the last, and still alerts
        tag: data.tag,
        renotify: Boolean(data.tag),
        data: { url: data.url || '/' }
    }));
});

self.addEventListener('notificationclick', (event) =>
{
    event.notification.close();
    const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
    event.waitUntil((async () =>
    {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
        if (open)
        {
            // The app takes itself to the lobby (src/utils/appUpdate.js); told
            // first, so a browser that won't hand over focus still gets there
            open.postMessage({ type: 'MANHUNT_OPEN', url });
            await open.focus().catch(() => {});
            return;
        }
        await self.clients.openWindow(url);
    })());
});
