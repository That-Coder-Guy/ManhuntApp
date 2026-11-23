// Runs before the app in every page the simulator serves (scripts/simulate.mjs
// adds it), and does nothing unless the page is one of the simulator's phones:
// a frame whose name holds that phone's part in the game. There it:
//
//   - keeps the phone's saved data apart (the phones share one browser, so
//     one localStorage: each gets its own keys, "sim:<lobby>:<phone>:…",
//     behind the usual interface);
//   - stands in for the phone's location and compass, fed by the simulator;
//   - passes "Before you play", takes its name and side, and, on the host's
//     phone, starts the game once everyone is in.
//
// A plain script, not a module: it has to finish before the app's starts.
(() =>
{
    let config = null;
    try { config = JSON.parse(window.name); } catch { /* not one of the simulator's phones */ }
    if (window.parent === window || !config || config.simulator !== true) return;

    const toSimulator = (message) => window.parent.postMessage({ ...message, phone: config.phone }, window.location.origin);

    // ---- Saved data: this phone's own ----

    const real = window.localStorage;
    // Per game as well as per phone, so two simulator tabs don't share phones
    const prefix = `sim:${config.lobby}:${config.phone}:`;
    const ownKeys = () => Object.keys(real).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    const methods = {
        getItem: (key) => real.getItem(prefix + key),
        setItem: (key, value) => real.setItem(prefix + key, String(value)),
        removeItem: (key) => real.removeItem(prefix + key),
        clear: () => ownKeys().forEach((key) => real.removeItem(prefix + key)),
        key: (index) => ownKeys()[index] ?? null
    };
    const store = new Proxy({}, {
        get(target, name)
        {
            if (name === 'length') return ownKeys().length;
            if (Object.hasOwn(methods, name)) return methods[name];
            return typeof name === 'string' ? methods.getItem(name) ?? undefined : undefined;
        },
        set(target, name, value) { methods.setItem(name, value); return true; },
        deleteProperty(target, name) { methods.removeItem(name); return true; },
        has: (target, name) => Object.hasOwn(methods, name) || name === 'length' || ownKeys().includes(name),
        ownKeys,
        getOwnPropertyDescriptor: (target, name) => (ownKeys().includes(name)
            ? { value: methods.getItem(name), enumerable: true, configurable: true, writable: true }
            : undefined)
    });
    Object.defineProperty(window, 'localStorage', { value: store, configurable: true });

    // When this game's data was first kept: the simulator's page clears out old games by it
    if (!store.getItem('sim.made')) store.setItem('sim.made', String(Date.now()));
    // No offer to install, and location already allowed
    store.setItem('manhunt.installOffered', '1');
    store.setItem('manhunt.permissionAnswers', JSON.stringify({ geolocation: 'granted' }));
    // What Home does after creating a lobby: the host key goes with the session
    const sessionKey = `manhunt_lobby_${config.lobby}`;
    if (config.hostKey && !store.getItem(sessionKey))
    {
        store.setItem(sessionKey, JSON.stringify({ hostKey: config.hostKey, timestamp: Date.now() }));
    }

    // ---- Location: wherever the simulator says this phone is ----

    let fix = null;
    let nextWatchId = 1;
    const watchers = new Map();
    const waiting = [];
    const position = () => ({
        coords: {
            // (a good fix out of doors: the app steadies a hider's position
            // by this, and a poor one makes it slow to follow a run)
            latitude: fix.latitude, longitude: fix.longitude, accuracy: 5,
            altitude: null, altitudeAccuracy: null, heading: null, speed: fix.speed
        },
        timestamp: Date.now()
    });
    Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
            getCurrentPosition(success)
            {
                if (fix) setTimeout(() => success(position()), 0);
                else waiting.push(success);
            },
            watchPosition(success)
            {
                const id = nextWatchId++;
                watchers.set(id, success);
                if (fix) setTimeout(() => watchers.get(id)?.(position()), 0);
                return id;
            },
            clearWatch(id) { watchers.delete(id); }
        }
    });
    if (navigator.permissions?.query)
    {
        const query = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (descriptor) => (descriptor?.name === 'geolocation'
            ? Promise.resolve({ state: 'granted', onchange: null })
            : query(descriptor));
    }

    // ---- Compass: the phone points the way it walks ----

    let heading = Math.random() * 360;
    let headingTarget = heading;
    if (window.DeviceOrientationEvent)
    {
        // No iPhone-style question to answer first
        Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { value: undefined, configurable: true });
        setInterval(() =>
        {
            const turn = ((headingTarget - heading + 540) % 360) - 180;
            heading = (heading + turn * 0.35 + 360) % 360;
            // alpha runs anticlockwise; flat on its back, the top of the phone points along the heading
            window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', {
                alpha: (360 - heading) % 360, beta: 0, gamma: 0, absolute: true
            }));
        }, 200);
    }

    window.addEventListener('message', (event) =>
    {
        if (event.source !== window.parent || event.origin !== window.location.origin) return;
        const message = event.data;
        if (message?.simulator !== 'position') return;
        fix = message;
        headingTarget = message.heading;
        const here = position();
        waiting.splice(0).forEach((success) => success(here));
        watchers.forEach((success) => success(here));
    });

    // ---- What a browser tab on a desk can't do, or shouldn't ----

    Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: { request: async () => ({ addEventListener() {}, release: async () => {} }) }
    });
    // No service worker (so no notifications): it would serve the app's page
    // from its cache, without this script
    delete Navigator.prototype.serviceWorker;

    // ---- Joining, and starting the game ----

    let socket = null;
    let selfId = null;
    let state = null;
    let busy = false;

    const ask = (event, payload = {}) => socket.timeout(4000).emitWithAck(event, payload).catch(() => null);

    async function setUp()
    {
        if (busy || !state || !socket?.connected || state.phase !== 'lobby') return;
        const players = Array.isArray(state.players) ? state.players : [];
        if (!players.some((p) => p.player_id === selfId)) return;

        busy = true;
        try {
            // Once per game: this phone's name and side
            if (!store.getItem('sim.ready'))
            {
                const answer = await ask('update-player', { name: config.name, is_seeker: config.seeker });
                if (answer?.status === 'success') store.setItem('sim.ready', '1');
                return;
            }

            // The host's phone starts the game, once, when everyone is in and
            // has taken their side. After that the lobby is the player's to run
            if (!config.start || store.getItem('sim.started')) return;
            const here = players.filter((p) => p.connected);
            const allIn = config.names.every((name) => here.some((p) => p.name === name));
            if (!allIn || here.filter((p) => p.is_seeker).length !== config.seekers) return;

            store.setItem('sim.started', '1');
            await ask('update-settings', { settings: config.settings });
            const started = await ask('start-game');
            if (started?.status !== 'success') store.removeItem('sim.started');
        } finally {
            busy = false;
        }
    }

    function report()
    {
        const me = state?.players?.find((p) => p.player_id === selfId);
        toSimulator({
            simulator: 'status',
            joined: Boolean(me),
            phase: state?.phase ?? null,
            name: me?.name ?? null,
            seeker: me?.is_seeker ?? null,
            host: me ? state.host_id === me.player_id : null
        });
    }

    function onState(next)
    {
        if (!next) return;
        state = next;
        report();
        setUp();
    }

    function hook(next)
    {
        next.on('joined', (data) =>
        {
            selfId = data.player_id;
            onState(data.state);
        });
        next.on('lobby-state', onState);
    }

    // The app puts its socket on window as it makes it (a handle for testing):
    // catching that moment means no message is missed. It deletes the handle
    // when it lets a socket go, which takes this trap with it, so it's set
    // again below
    function watchForSocket()
    {
        Object.defineProperty(window, '__manhuntSocket', {
            configurable: true,
            enumerable: true,
            get: () => socket,
            set(next)
            {
                socket = next;
                if (next) hook(next);
            }
        });
    }
    watchForSocket();

    setInterval(() =>
    {
        if (!Object.getOwnPropertyDescriptor(window, '__manhuntSocket')?.set)
        {
            const current = window.__manhuntSocket ?? null;
            socket = null;
            watchForSocket();
            if (current) window.__manhuntSocket = current;
        }

        // "Before you play": location is allowed already, so Continue
        const gate = document.querySelector('[data-testid="gate-continue"]');
        if (gate && !gate.disabled && !gate.classList.contains('button-disabled')) gate.click();

        setUp();
    }, 300);
    setInterval(report, 2000);

    toSimulator({ simulator: 'hello' });
})();
