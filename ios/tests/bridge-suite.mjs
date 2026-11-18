// The tests for the script both native apps run inside their web view
// (bridge.js), against a stand-in for the page and the app. The iPhone and
// Android apps talk to the script differently, so each runs these with its
// own stand-in: ios/tests/bridge.test.mjs and android/tests/bridge.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

const COPIES = {
    iphone: new URL('../Sources/Manhunt/Resources/bridge.js', import.meta.url),
    android: new URL('../../android/app/src/main/assets/bridge.js', import.meta.url)
};

/**
 * Run the suite as one of the apps.
 * @param {'iphone' | 'android'} app
 */
export function bridgeSuite(app)
{
    const source = readFileSync(COPIES[app], 'utf8');
    // What each app puts in __manhuntInitial: only the iPhone app feeds the page its location
    const nativeLocation = app === 'iphone';

    /**
     * A page with the app behind it. `sent` collects the page's messages,
     * `answers` are the app's replies by type, `initial` overrides what the
     * app knew when the page opened, `storage` is the page's localStorage,
     * `path` is the page's address, and `browser` adds things the web view
     * already has.
     */
    function page({ answers = {}, initial = {}, storage = {}, native = true, path = '/', browser = {} } = {})
    {
        const sent = [];
        const browserQueries = [];
        let reloads = 0;

        class Navigator {}
        Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => ({ request: async () => ({}) }) });
        const navigator = Object.assign(new Navigator(), {
            standalone: false,
            geolocation: { watchPosition: 'the web view\'s own', getCurrentPosition: 'the web view\'s own', clearWatch: 'the web view\'s own' },
            permissions: { query: async (descriptor) => { browserQueries.push(descriptor.name); return { state: 'prompt' }; } },
            ...browser.navigator
        });
        // Style rules the script adds to the page
        const styles = [];
        const document = {
            head: null,
            documentElement: { appendChild: (element) => styles.push(element.textContent) },
            createElement: () => ({ textContent: '' }),
            addEventListener() {}
        };
        const localStorage = { getItem: (key) => storage[key] ?? null };
        const window = { navigator, document, localStorage, location: { pathname: path, reload: () => { reloads += 1; } }, ...browser.window };

        const answer = (message) =>
        {
            const reply = answers[message.type];
            return typeof reply === 'function' ? reply(message) : reply ?? null;
        };
        if (native)
        {
            window.__manhuntInitial = { notifications: 'prompt', nativeLocation, ...initial };
            if (app === 'iphone')
            {
                window.webkit = { messageHandlers: { manhunt: { postMessage: async (message) => { sent.push(message); return answer(message); } } } };
            }
            else
            {
                const channel = {
                    onmessage: null,
                    postMessage(text)
                    {
                        const message = JSON.parse(text);
                        sent.push(message);
                        const result = answer(message);
                        queueMicrotask(() => channel.onmessage?.({ data: JSON.stringify({ id: message.id, result }) }));
                    }
                };
                window.manhuntApp = channel;
            }
        }

        const context = vm.createContext({ window, navigator, document, localStorage, Navigator, console, setTimeout, clearTimeout, Event, EventTarget, Promise, Date, DOMException });
        vm.runInContext(source, context);
        return { window, navigator, sent, styles, browserQueries, reloads: () => reloads, of: (type) => sent.filter((message) => message.type === type) };
    }

    const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
    const FIX = { latitude: 39.19, longitude: -96.58, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null, timestamp: 1_700_000_000_000 };

    /** The web app's connection, as it leaves it on window.__manhuntSocket */
    function connect(window)
    {
        const socket = new EventEmitter();
        window.__manhuntSocket = socket;
        return socket;
    }

    const sessions = (of) => of('session').map(({ active, playing, lobby }) => ({ active, playing, lobby }));

    test(`${app}: the app's copy of the script is the same as the other app's`, () =>
    {
        const other = app === 'iphone' ? 'android' : 'iphone';
        assert.equal(source, readFileSync(COPIES[other], 'utf8'), 'ios/Sources/Manhunt/Resources/bridge.js and android/app/src/main/assets/bridge.js must be identical: copy one over the other');
    });

    test(`${app}: does nothing outside the app`, () =>
    {
        const { window, navigator } = page({ native: false });
        assert.equal(window.__manhuntNative, undefined);
        assert.equal(window.Notification, undefined);
        assert.equal(navigator.standalone, false);
        assert.ok('wakeLock' in navigator);
    });

    test(`${app}: tells the web app it is the installed app`, () =>
    {
        assert.equal(page().navigator.standalone, true);
    });

    test(`${app}: there is no wake lock, so the web app offers no "Keep screen on"`, () =>
    {
        // src/hooks/usePermissions.js: wakeLockSupported() is 'wakeLock' in navigator
        assert.equal('wakeLock' in page().navigator, false);
    });

    test(`${app}: a "Keep screen on" row from an older server's web app is hidden`, () =>
    {
        // Older versions list it among the permissions, greyed out, wake lock or not
        const { styles } = page();
        assert.equal(styles.length, 1);
        assert.match(styles[0], /ion-item:has\(\[data-testid="toggle-wake"\]\)/);
        assert.match(styles[0], /display:\s*none/);
    });

    test(`${app}: outside the app, nothing on the page is hidden`, () =>
    {
        assert.equal(page({ native: false }).styles.length, 0);
    });

    test(`${app}: the web app's "Open settings" button asks the app`, () =>
    {
        const { window, of } = page();
        // src/utils/nativeApp.js looks for exactly this
        assert.equal(typeof window.__manhuntNative.openSettings, 'function');
        window.__manhuntNative.openSettings();
        assert.equal(of('settings').length, 1);
        // The app says what Manhunt needs there first
        assert.equal(of('settings')[0].direct, false);
    });

    test(`${app}: the web app's popup for turning a permission off sends the player straight to Settings`, () =>
    {
        const { window, of } = page();
        window.__manhuntNative.openSettings({ direct: true });
        assert.equal(of('settings').length, 1);
        assert.equal(of('settings')[0].direct, true);
    });

    // ---- Location ----

    if (!nativeLocation)
    {
        test(`${app}: location is left to the web view`, () =>
        {
            const { navigator, of } = page();
            assert.equal(navigator.geolocation.watchPosition, 'the web view\'s own');
            assert.equal(of('location-start').length, 0);
        });
    }
    else
    {
        test(`${app}: a watch runs the phone's location service until it is cleared`, () =>
        {
            const { window, navigator, sent } = page();
            const types = () => sent.map((message) => message.type);
            const fixes = [];
            const id = navigator.geolocation.watchPosition((position) => fixes.push(position));
            assert.ok(types().includes('location-start'));

            window.__manhuntNative.location(FIX);
            window.__manhuntNative.location({ ...FIX, latitude: 39.2 });
            assert.equal(fixes.length, 2);
            assert.equal(fixes[0].coords.latitude, 39.19);
            assert.equal(fixes[0].coords.accuracy, 8);
            assert.equal(fixes[0].timestamp, FIX.timestamp);
            assert.equal(fixes[0].coords.timestamp, undefined);
            assert.equal(fixes[1].coords.latitude, 39.2);

            navigator.geolocation.clearWatch(id);
            assert.equal(types().at(-1), 'location-stop');
            window.__manhuntNative.location(FIX);
            assert.equal(fixes.length, 2);
        });

        test(`${app}: the service stays on while anything is still listening`, () =>
        {
            const { navigator, of } = page();
            const first = navigator.geolocation.watchPosition(() => {});
            const second = navigator.geolocation.watchPosition(() => {});
            navigator.geolocation.clearWatch(first);
            assert.equal(of('location-stop').length, 0);
            navigator.geolocation.clearWatch(second);
            assert.equal(of('location-start').length, 1);
            assert.equal(of('location-stop').length, 1);
        });

        test(`${app}: fixes with nothing listening are harmless (they keep the page awake in the background)`, () =>
        {
            const { window } = page();
            assert.doesNotThrow(() => window.__manhuntNative.location(FIX));
        });

        test(`${app}: getCurrentPosition answers once`, () =>
        {
            const { window, navigator, of } = page();
            const fixes = [];
            navigator.geolocation.getCurrentPosition((position) => fixes.push(position));
            window.__manhuntNative.location(FIX);
            window.__manhuntNative.location(FIX);
            assert.equal(fixes.length, 1);
            assert.equal(of('location-stop').length, 1);
        });

        test(`${app}: a refusal reaches the web app as PERMISSION_DENIED, and a watch survives it`, () =>
        {
            const { window, navigator } = page();
            const errors = [];
            const fixes = [];
            navigator.geolocation.watchPosition((position) => fixes.push(position), (error) => errors.push(error));
            window.__manhuntNative.locationError(1, 'Not allowed');
            assert.equal(errors.length, 1);
            assert.equal(errors[0].code, errors[0].PERMISSION_DENIED);
            assert.notEqual(errors[0].code, errors[0].TIMEOUT);

            // Allowed later in Settings: fixes flow again
            window.__manhuntNative.location(FIX);
            assert.equal(fixes.length, 1);
        });

        test(`${app}: a timeout does not run while the phone is still asking`, async () =>
        {
            const { window, navigator } = page({ answers: { 'permission-query': 'prompt' } });
            const errors = [];
            navigator.geolocation.getCurrentPosition(() => {}, (error) => errors.push(error), { timeout: 10 });
            await settle(40);
            assert.equal(errors.length, 0);

            window.__manhuntNative.permission('geolocation', 'granted');
            await settle(40);
            assert.equal(errors.length, 1);
            assert.equal(errors[0].code, errors[0].TIMEOUT);
        });

        test(`${app}: a timeout runs at once when location is already allowed`, async () =>
        {
            const { navigator } = page({ answers: { 'permission-query': 'granted' } });
            await settle();
            const errors = [];
            navigator.geolocation.getCurrentPosition(() => {}, (error) => errors.push(error), { timeout: 10 });
            await settle(40);
            assert.equal(errors.length, 1);
        });

        test(`${app}: a fix in time cancels the timeout`, async () =>
        {
            const { window, navigator } = page({ answers: { 'permission-query': 'granted' } });
            await settle();
            const errors = [];
            navigator.geolocation.watchPosition(() => {}, (error) => errors.push(error), { timeout: 20 });
            window.__manhuntNative.location(FIX);
            await settle(50);
            assert.equal(errors.length, 0);
        });

        test(`${app}: a recent fix answers a new request at once`, async () =>
        {
            const { window, navigator } = page();
            navigator.geolocation.watchPosition(() => {});
            window.__manhuntNative.location({ ...FIX, timestamp: Date.now() });

            const fresh = [];
            navigator.geolocation.getCurrentPosition((position) => fresh.push(position), null, { maximumAge: 10_000 });
            const strict = [];
            navigator.geolocation.getCurrentPosition((position) => strict.push(position));
            await settle();
            assert.equal(fresh.length, 1);
            assert.equal(strict.length, 0);
        });
    }

    // ---- Permissions ----

    test(`${app}: the phone answers for location and the camera, the browser for the rest`, async () =>
    {
        const { navigator, browserQueries } = page({ answers: { 'permission-query': (message) => (message.name === 'camera' ? 'denied' : 'granted') } });
        assert.equal((await navigator.permissions.query({ name: 'geolocation' })).state, 'granted');
        assert.equal((await navigator.permissions.query({ name: 'camera' })).state, 'denied');
        assert.equal((await navigator.permissions.query({ name: 'midi' })).state, 'prompt');
        assert.deepEqual(browserQueries, ['midi']);
    });

    test(`${app}: a permission changed in Settings reaches the web app`, async () =>
    {
        const { window, navigator } = page({ answers: { 'permission-query': 'prompt' } });
        const status = await navigator.permissions.query({ name: 'geolocation' });
        const seen = [];
        status.onchange = () => seen.push(status.state);
        status.addEventListener('change', () => seen.push('event'));

        window.__manhuntNative.permission('geolocation', 'granted');
        assert.deepEqual(seen, ['event', 'granted']);
        window.__manhuntNative.permission('geolocation', 'granted');
        assert.equal(seen.length, 2);
        window.__manhuntNative.permission('geolocation', 'nonsense');
        assert.equal(status.state, 'granted');
    });

    // ---- Notifications ----

    test(`${app}: the web app sees notifications as the app knew them when the page opened`, () =>
    {
        assert.equal(page().window.Notification.permission, 'default');
        assert.equal(page({ initial: { notifications: 'granted' } }).window.Notification.permission, 'granted');
        assert.equal(page({ initial: { notifications: 'denied' } }).window.Notification.permission, 'denied');
        assert.equal(typeof page().window.PushManager, 'function');
    });

    test(`${app}: asking for notifications asks the phone`, async () =>
    {
        const { window, of } = page({ answers: { 'notifications-request': 'granted' } });
        assert.equal(await window.Notification.requestPermission(), 'granted');
        assert.equal(of('notifications-request').length, 1);
        assert.equal(window.Notification.permission, 'granted');

        window.__manhuntNative.permission('notifications', 'denied');
        assert.equal(window.Notification.permission, 'denied');
    });

    test(`${app}: notifications changed in Settings redraw the switches, but never reload a lobby`, () =>
    {
        const home = page({ initial: { notifications: 'denied' } });
        home.window.__manhuntNative.permission('notifications', 'denied');
        assert.equal(home.reloads(), 0, 'nothing changed: nothing to redraw');
        home.window.__manhuntNative.permission('notifications', 'granted');
        assert.equal(home.window.Notification.permission, 'granted');
        assert.equal(home.reloads(), 1);

        const lobby = page({ initial: { notifications: 'denied' }, path: '/lobby/12f3ccda-1265-487e-95f1-12e2bd2393e0' });
        lobby.window.__manhuntNative.permission('notifications', 'granted');
        assert.equal(lobby.window.Notification.permission, 'granted');
        assert.equal(lobby.reloads(), 0);
    });

    test(`${app}: a web view with no service worker gets a stand-in the web app can live with`, async () =>
    {
        const { navigator } = page();
        // What src/utils/appUpdate.js and push.js do with it
        assert.ok('serviceWorker' in navigator);
        assert.doesNotThrow(() => navigator.serviceWorker.addEventListener('message', () => {}));
        assert.doesNotThrow(() => navigator.serviceWorker.startMessages?.());
        await assert.rejects(navigator.serviceWorker.register('/sw.js'));
        const registration = await navigator.serviceWorker.ready;
        // No push manager: the web app's attempt to subscribe throws, is caught, and nothing is sent to the server
        assert.equal(registration.pushManager, undefined);
    });

    test(`${app}: a web view that has a service worker keeps it`, () =>
    {
        const real = { ready: 'the web view\'s own' };
        const { navigator } = page({ browser: { navigator: { serviceWorker: real } } });
        assert.equal(navigator.serviceWorker, real);
    });

    // ---- Following the lobby ----

    test(`${app}: the app is told when the player is in a lobby, and when a game runs in it`, () =>
    {
        const { window, of } = page();
        const socket = connect(window);
        assert.equal(of('session').length, 0);

        socket.emit('joined', { lobby_name: 'Riverside Park', state: { phase: 'lobby' } });
        socket.emit('lobby-state', { phase: 'lobby' });
        socket.emit('lobby-state', { phase: 'playing' });
        socket.emit('lobby-state', { phase: 'playing' });
        socket.emit('lobby-state', { phase: 'ended' });

        assert.deepEqual(sessions(of), [
            { active: true, playing: false, lobby: 'Riverside Park' },
            { active: true, playing: true, lobby: 'Riverside Park' },
            { active: true, playing: false, lobby: 'Riverside Park' }
        ]);
    });

    test(`${app}: rejoining a game that is already running counts as a game`, () =>
    {
        const { window, of } = page();
        connect(window).emit('joined', { lobby_name: 'Park', state: { phase: 'playing' } });
        assert.deepEqual(sessions(of), [{ active: true, playing: true, lobby: 'Park' }]);
    });

    test(`${app}: leaving or being removed ends it; a dropped connection does not`, () =>
    {
        const { window, of } = page();
        const socket = connect(window);
        socket.emit('joined', { lobby_name: 'Park', state: { phase: 'playing' } });

        socket.emit('disconnect', 'transport close');
        socket.emit('disconnect', 'ping timeout');
        assert.deepEqual(of('session').map((message) => message.active), [true]);

        socket.emit('disconnect', 'io client disconnect');
        assert.deepEqual(sessions(of).at(-1), { active: false, playing: false, lobby: 'Park' });

        const again = connect(window);
        again.emit('joined', { lobby_name: 'Park', state: { phase: 'lobby' } });
        again.emit('fatal-error', { status: 'kicked' });
        assert.deepEqual(of('session').map((message) => message.active), [true, false, true, false]);
    });

    test(`${app}: an old connection is not listened to once a new one replaces it`, () =>
    {
        const { window, of } = page();
        const old = connect(window);
        const current = connect(window);
        old.emit('lobby-state', { phase: 'playing' });
        assert.equal(of('session').length, 0);
        current.emit('lobby-state', { phase: 'playing' });
        assert.equal(of('session').length, 1);
        assert.equal(window.__manhuntSocket, current);
    });

    test(`${app}: someone found is passed to the app, in the server's words`, () =>
    {
        const { window, of } = page();
        const socket = connect(window);
        socket.emit('joined', { lobby_name: 'Riverside Park', state: { phase: 'playing' } });

        socket.emit('player-found', { player_id: 'a', name: 'Maya', hiders_left: 2 });
        socket.emit('player-found', { player_id: 'b', name: 'Sam', hiders_left: 1 });
        socket.emit('player-found', { player_id: 'c', name: '', hiders_left: 0 });

        assert.deepEqual(of('found').map(({ title, body }) => ({ title, body })), [
            { title: 'Maya was found', body: '2 hiders left · Riverside Park' },
            { title: 'Sam was found', body: '1 hider left · Riverside Park' },
            { title: 'Everyone was found', body: 'A hider was the last. The seekers win.' }
        ]);
    });

    test(`${app}: nothing is passed on once the player has turned notifications off in the web app`, () =>
    {
        const { window, of } = page({ storage: { 'manhunt.notificationsOff': '1' } });
        connect(window).emit('player-found', { name: 'Maya', hiders_left: 2 });
        assert.equal(of('found').length, 0);
    });

    // ---- Sharing ----

    test(`${app}: sharing goes to the app where the web view has none`, async () =>
    {
        const shared = page({ answers: { share: true } });
        await shared.navigator.share({ title: 'Join', text: 'Tap to join', url: 'https://example.test/lobby/1' });
        assert.deepEqual(shared.of('share').map(({ title, text, url }) => ({ title, text, url })), [{ title: 'Join', text: 'Tap to join', url: 'https://example.test/lobby/1' }]);

        await assert.rejects(page({ answers: { share: false } }).navigator.share({ url: 'x' }), { name: 'AbortError' });
    });

    test(`${app}: a web view that can share keeps its own`, () =>
    {
        const own = () => {};
        assert.equal(page({ browser: { navigator: { share: own } } }).navigator.share, own);
    });
}
