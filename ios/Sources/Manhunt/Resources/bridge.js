// Runs inside the iOS app's web view, before the web app's own scripts.
//
// The web app is loaded unchanged from the game server. This hands a few
// browser features over to the phone itself, where a web view does them badly
// or not at all:
//   - Location comes from the app's own location service, so iOS asks once
//     (a web view would ask again on every launch).
//   - "Is location / the camera allowed?" is answered by the phone.
//   - Keeping the screen on works (web views have no wake lock).
//   - The web app is told it's the installed app, so it doesn't offer to add
//     itself to the Home Screen and asks for permissions once, in one place.
// The other half is GameWebModel.swift, which receives the messages sent here.
(() =>
{
    'use strict';

    const handler = window.webkit?.messageHandlers?.manhunt;
    if (!handler || window.__manhuntNative) return;

    /** Ask the app something; resolves with its answer, or null if it can't say */
    const send = (type, data) =>
    {
        try {
            return Promise.resolve(handler.postMessage({ type, ...data })).catch(() => null);
        } catch {
            return Promise.resolve(null);
        }
    };

    const define = (target, name, value) =>
    {
        try {
            Object.defineProperty(target, name, { configurable: true, writable: true, value });
        } catch { /* left as the web view has it */ }
    };

    // ---- The installed app ----

    try {
        Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
    } catch { /* the web app then behaves as it does in a browser */ }

    // ---- Location ----

    const PERMISSION_DENIED = 1;
    const POSITION_UNAVAILABLE = 2;
    const TIMEOUT = 3;
    const positionError = (code, message) => ({ code, message, PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT });

    // Everything waiting for positions: id → { success, error, once, timer }
    const watchers = new Map();
    let nextWatchId = 1;
    let lastFix = null;
    let locating = false;

    // The phone's location service runs only while something is listening
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

    // A timeout only counts time spent looking for a position, not time the
    // player spends reading iOS's "Allow location?" prompt (as in a browser)
    let locationAllowed = false;

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

    if (navigator.geolocation)
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
    const STATES = ['granted', 'denied', 'prompt'];
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

    // ---- Keeping the screen on ----

    let wakeLocks = 0;

    class NativeWakeLock extends EventTarget
    {
        constructor()
        {
            super();
            this.type = 'screen';
            this.released = false;
            this.onrelease = null;
        }

        async release()
        {
            if (this.released) return;
            this.released = true;
            wakeLocks -= 1;
            if (wakeLocks === 0) send('wake-lock', { held: false });
            const event = new Event('release');
            this.dispatchEvent(event);
            try { this.onrelease?.call(this, event); } catch (error) { console.error(error); }
        }
    }

    define(navigator, 'wakeLock', {
        async request(type = 'screen')
        {
            if (type !== 'screen') throw new TypeError(`Unknown wake lock type "${type}"`);
            wakeLocks += 1;
            if (wakeLocks === 1) send('wake-lock', { held: true });
            return new NativeWakeLock();
        }
    });

    // ---- What the app calls ----

    define(window, '__manhuntNative', Object.freeze({
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
        /** A permission changed, in the prompt or in the phone's Settings */
        permission: permissionChanged
    }));
})();
