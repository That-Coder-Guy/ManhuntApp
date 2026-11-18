// Runs inside the native apps' web view, before the web app's own scripts.
// The iPhone and Android apps carry the same file (ios/Sources/Manhunt/
// Resources/bridge.js and android/app/src/main/assets/bridge.js; a test keeps
// the two copies identical).
//
// The web app is loaded unchanged from the game server. This hands a few
// browser features over to the phone, where a web view does them badly or not
// at all, and tells the app what it needs to know to keep a player in their
// lobby while the phone is locked:
//   - The web app is told it's the installed app, so it doesn't offer to add
//     itself to the Home Screen and asks for permissions once, in one place.
//   - "Is location / the camera allowed?" is answered by the phone.
//   - On iPhones, location comes from the app's own location service, which
//     keeps running with the phone locked (a web view's stops).
//   - Staying in the lobby. The app is told while the player is in one, and
//     keeps itself running and connected for as long. That replaces the web
//     app's "Keep screen on": with no wake lock here, its Settings page
//     doesn't offer it.
//   - Notifications. The server's web pushes can't reach a web view, so the
//     app shows the phone's own when someone is found. The web app's
//     Notifications switch asks for, and turns off, those instead.
//   - The share sheet for invites, where the web view has none.
//   - The phone's Settings. Nothing in the app can get back a permission
//     that was refused: only the phone's Settings can. The web app's "Open
//     settings" button (shown beside a blocked switch) asks the app, which
//     says what Manhunt needs there and opens them.
// The other half is GameWebModel.swift on iPhones and PageBridge.kt on Android.
(() =>
{
    'use strict';

    // Put there by the app, for the game server's own page only
    const iphone = window.webkit?.messageHandlers?.manhunt;
    const android = window.manhuntApp;
    if ((!iphone && !android) || window.__manhuntNative) return;

    // What the app knew when this page opened: { notifications, nativeLocation }
    const initial = window.__manhuntInitial ?? {};

    // ---- Asking the app ----

    const waiting = new Map();
    let nextRequest = 1;

    if (android)
    {
        android.onmessage = (event) =>
        {
            let reply;
            try { reply = JSON.parse(event.data); } catch { return; }
            const resolve = waiting.get(reply.id);
            waiting.delete(reply.id);
            resolve?.(reply.result ?? null);
        };
    }

    /** Ask the app something; resolves with its answer, or null if it can't say */
    function send(type, data)
    {
        try {
            // iPhones answer the message itself; Android answers with a message back
            if (iphone) return Promise.resolve(iphone.postMessage({ type, ...data })).catch(() => null);
            return new Promise((resolve) =>
            {
                const id = nextRequest++;
                waiting.set(id, resolve);
                android.postMessage(JSON.stringify({ id, type, ...data }));
            });
        } catch {
            return Promise.resolve(null);
        }
    }

    const define = (target, name, value) =>
    {
        try {
            Object.defineProperty(target, name, { configurable: true, writable: true, value });
        } catch { /* left as the web view has it */ }
    };

    const plain = (value) => (typeof value === 'string' ? value : '');

    // ---- The installed app ----

    try {
        Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
    } catch { /* the web app then behaves as it does in a browser */ }

    // ---- No "Keep screen on" ----
    //
    // The web app keeps the screen on through a game because a web page stops
    // when the screen goes off. The app doesn't stop, so there is nothing to
    // keep the screen on for: the wake lock is taken away, and with it the
    // web app's switch (its Settings page shows that only where there is one).

    try { delete Navigator.prototype.wakeLock; } catch { /* not there */ }
    try { delete navigator.wakeLock; } catch { /* not there */ }

    // A server still running an older version of the web app lists the switch
    // among the permissions whether there's a wake lock or not, greyed out
    // and "Not available on this device". The app and the server are updated
    // separately, so the row is hidden here too, whatever the server sends.
    function hideKeepScreenOn()
    {
        const style = document.createElement('style');
        style.textContent = 'ion-item:has([data-testid="toggle-wake"]) { display: none !important; }';
        (document.head ?? document.documentElement)?.appendChild(style);
    }
    try {
        if (document.documentElement) hideKeepScreenOn();
        else document.addEventListener('DOMContentLoaded', hideKeepScreenOn, { once: true });
    } catch { /* the row then shows as not available */ }

    // ---- Location, from the app (iPhones) ----

    const STATES = ['granted', 'denied', 'prompt'];
    const PERMISSION_DENIED = 1;
    const POSITION_UNAVAILABLE = 2;
    const TIMEOUT = 3;
    const positionError = (code, message) => ({ code, message, PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT });

    // Everything waiting for positions: id → { success, error, once, timer, timeout }
    const watchers = new Map();
    let nextWatchId = 1;
    let lastFix = null;
    let locating = false;
    // A timeout only counts time spent looking for a position, not time the
    // player spends reading the "Allow location?" prompt (as in a browser)
    let locationAllowed = false;

    // The phone's location service runs while something is listening (and,
    // whatever the page does, for as long as the player is in a lobby)
    function syncLocating()
    {
        const wanted = watchers.size > 0;
        if (wanted === locating) return;
        locating = wanted;
        send(wanted ? 'location-start' : 'location-stop');
    }

    function finish(id, watcher)
    {
        clearTimeout(watcher.timer);
        watcher.timer = null;
        watcher.timeout = null;
        if (!watcher.once) return;
        watchers.delete(id);
        syncLocating();
    }

    function deliver(id, position)
    {
        const watcher = watchers.get(id);
        if (!watcher) return;
        finish(id, watcher);
        try { watcher.success(position); } catch (error) { console.error(error); }
    }

    function fail(id, code, message)
    {
        const watcher = watchers.get(id);
        if (!watcher) return;
        finish(id, watcher);
        try { watcher.error?.(positionError(code, message)); } catch (error) { console.error(error); }
    }

    function startTimeout(id, watcher)
    {
        if (watcher.timeout === null || watcher.timer !== null) return;
        watcher.timer = setTimeout(() => fail(id, TIMEOUT, 'Timed out waiting for a position'), watcher.timeout);
        watcher.timeout = null;
    }

    function setLocationAllowed(allowed)
    {
        locationAllowed = allowed;
        if (allowed) watchers.forEach((watcher, id) => startTimeout(id, watcher));
    }

    function listen(success, error, options, once)
    {
        if (typeof success !== 'function') throw new TypeError('A success callback is required');

        const id = nextWatchId++;
        const timeout = Number(options?.timeout);
        const watcher = {
            success,
            error: typeof error === 'function' ? error : null,
            once,
            timer: null,
            timeout: Number.isFinite(timeout) && timeout >= 0 ? timeout : null
        };
        watchers.set(id, watcher);
        if (locationAllowed) startTimeout(id, watcher);

        // A recent enough fix answers at once, as the browser's own would
        const maximumAge = Number(options?.maximumAge);
        if (lastFix && maximumAge > 0 && Date.now() - lastFix.timestamp <= maximumAge)
        {
            const fix = lastFix;
            setTimeout(() => deliver(id, fix), 0);
        }

        syncLocating();
        return id;
    }

    if (initial.nativeLocation === true && navigator.geolocation)
    {
        define(navigator.geolocation, 'getCurrentPosition', (success, error, options) => { listen(success, error, options, true); });
        define(navigator.geolocation, 'watchPosition', (success, error, options) => listen(success, error, options, false));
        define(navigator.geolocation, 'clearWatch', (id) =>
        {
            const watcher = watchers.get(id);
            if (!watcher) return;
            clearTimeout(watcher.timer);
            watchers.delete(id);
            syncLocating();
        });
    }

    // ---- Permissions the phone answers for ----

    const NATIVE_PERMISSIONS = ['geolocation', 'camera'];
    const issued = new Map(NATIVE_PERMISSIONS.map((name) => [name, new Set()]));

    class NativePermissionStatus extends EventTarget
    {
        constructor(name, state)
        {
            super();
            this.name = name;
            this.state = state;
            this.onchange = null;
        }
    }

    function permissionChanged(name, state)
    {
        if (!STATES.includes(state)) return;
        if (name === 'geolocation') setLocationAllowed(state === 'granted');
        for (const status of issued.get(name) ?? [])
        {
            if (status.state === state) continue;
            status.state = state;
            const event = new Event('change');
            status.dispatchEvent(event);
            try { status.onchange?.call(status, event); } catch (error) { console.error(error); }
        }
    }

    const browserQuery = navigator.permissions?.query?.bind(navigator.permissions);

    async function query(descriptor)
    {
        const name = descriptor?.name;
        if (!NATIVE_PERMISSIONS.includes(name))
        {
            if (browserQuery) return browserQuery(descriptor);
            throw new TypeError(`Permission "${name}" can't be queried here`);
        }
        const answer = await send('permission-query', { name });
        const status = new NativePermissionStatus(name, STATES.includes(answer) ? answer : 'prompt');
        issued.get(name).add(status);
        return status;
    }

    if (navigator.permissions) define(navigator.permissions, 'query', query);
    else define(navigator, 'permissions', { query });

    send('permission-query', { name: 'geolocation' }).then((answer) => permissionChanged('geolocation', answer));

    // ---- Sharing an invite ----

    if (typeof navigator.share !== 'function')
    {
        define(navigator, 'share', async (data) =>
        {
            const shared = await send('share', { title: plain(data?.title), text: plain(data?.text), url: plain(data?.url) });
            if (shared !== true) throw new DOMException('Sharing isn\'t available', 'AbortError');
        });
    }

    // ---- Notifications: the phone's own, in place of web push ----

    // Whether the phone lets the app notify, as the app knew it when this
    // page opened and as it changes
    let notifications = STATES.includes(initial.notifications) ? initial.notifications : 'prompt';
    const asWebPermission = (state) => (state === 'prompt' ? 'default' : state);

    // The web app shows its Notifications switch when the browser has
    // notifications, push and a service worker. These stand in for whichever
    // the web view lacks: the switch then asks the phone, and the web push
    // subscription it would go on to make quietly fails (there is no real
    // push here), so the server sends this phone none. That includes the
    // "Still playing?" reminder to players who have dropped out, which the
    // app has no use for: it keeps them in.
    define(window, 'Notification', {
        get permission() { return asWebPermission(notifications); },
        async requestPermission()
        {
            const answer = await send('notifications-request');
            if (STATES.includes(answer)) notifications = answer;
            return asWebPermission(notifications);
        }
    });
    if (!('PushManager' in window)) define(window, 'PushManager', function PushManager() {});
    if (!('serviceWorker' in navigator))
    {
        // iPhones: a web view has no service worker. Registering one fails, as
        // it would offline, and the web app carries on without (src/utils/appUpdate.js)
        const absent = new EventTarget();
        define(navigator, 'serviceWorker', Object.assign(absent, {
            controller: null,
            ready: Promise.resolve({}),
            register: () => Promise.reject(new Error('This app has no service worker')),
            getRegistration: async () => undefined,
            getRegistrations: async () => [],
            startMessages() {}
        }));
    }

    // The web app's own "notifications off" choice (src/utils/push.js)
    const notificationsWanted = () =>
    {
        try { return localStorage.getItem('manhunt.notificationsOff') !== '1'; } catch { return true; }
    };

    // ---- Following the lobby ----
    //
    // The web app leaves its connection to the server on window.__manhuntSocket.
    // Listening on it tells the app when the player is in a lobby, whether a
    // game is running, and when someone is found, exactly as the web app
    // itself hears it.

    let socket = null;
    let lobbyName = '';
    let inLobby = false;
    let playing = false;

    function setSession(nextInLobby, nextPlaying)
    {
        nextPlaying = nextInLobby && nextPlaying;
        if (nextInLobby === inLobby && nextPlaying === playing) return;
        inLobby = nextInLobby;
        playing = nextPlaying;
        send('session', { active: inLobby, playing, lobby: lobbyName });
    }

    function someoneFound(data)
    {
        if (!notificationsWanted()) return;
        const name = plain(data?.name) || 'A hider';
        const left = Number(data?.hiders_left);
        // The server's wording for the same web push (notifyFound in
        // server/server.js). The app shows it only if the player isn't looking
        // at the game, which covers the player who was found: they have just
        // tapped the button.
        send('found', left === 0
            ? { title: 'Everyone was found', body: `${name} was the last. The seekers win.` }
            : { title: `${name} was found`, body: [`${left} ${left === 1 ? 'hider' : 'hiders'} left`, lobbyName].filter(Boolean).join(' · ') });
    }

    function follow(next)
    {
        socket = next;
        if (typeof next?.on !== 'function') return setSession(false, false);

        const current = (handler) => (...args) => { if (socket === next) handler(...args); };
        next.on('joined', current((data) =>
        {
            lobbyName = plain(data?.lobby_name);
            setSession(true, data?.state?.phase === 'playing');
        }));
        next.on('lobby-state', current((state) => setSession(true, state?.phase === 'playing')));
        next.on('player-found', current(someoneFound));
        // Removed from the lobby, or left it: a dropped connection is neither, and comes back
        next.on('fatal-error', current(() => setSession(false, false)));
        next.on('disconnect', current((reason) => { if (reason === 'io client disconnect') setSession(false, false); }));
    }

    try {
        Object.defineProperty(window, '__manhuntSocket', { configurable: true, get: () => socket, set: follow });
    } catch { /* the app can't tell when the player is in a lobby: it behaves as a web page would */ }

    // ---- What the app calls, and the one thing the web app does ----

    define(window, '__manhuntNative', Object.freeze({
        /**
         * For the web app (src/utils/nativeApp.js): open the phone's Settings
         * for Manhunt. The app first says what Manhunt needs there, unless
         * `direct` (the page has already said why it's sending the player)
         */
        openSettings(options) { send('settings', { direct: options?.direct === true }); },
        /** A new fix from the phone: { latitude, longitude, accuracy, …, timestamp } */
        location(fix)
        {
            const { timestamp, ...coords } = fix;
            lastFix = Object.freeze({ coords: Object.freeze(coords), timestamp });
            for (const id of [...watchers.keys()]) deliver(id, lastFix);
        },
        /** The phone can't give a position (code as in GeolocationPositionError) */
        locationError(code, message)
        {
            for (const id of [...watchers.keys()]) fail(id, code, message);
        },
        /** A permission changed, in a prompt or in the phone's Settings */
        permission(name, state)
        {
            if (name !== 'notifications') return permissionChanged(name, state);
            if (!STATES.includes(state) || state === notifications) return;
            notifications = state;
            // The web app reads this once, when a page of switches opens. One
            // that is open now is redrawn by loading it afresh, but never
            // from under a lobby.
            if (!plain(window.location?.pathname).startsWith('/lobby/')) window.location?.reload?.();
        }
    }));
})();
