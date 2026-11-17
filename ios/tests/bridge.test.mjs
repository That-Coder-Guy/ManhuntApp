// Tests for the script the iOS app runs inside its web view
// (Sources/Manhunt/Resources/bridge.js), against a stand-in for the page and
// the app:
//
//   node --test ios/tests/bridge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../Sources/Manhunt/Resources/bridge.js', import.meta.url), 'utf8');

/** A page with the app behind it: `sent` collects messages, `answers` are the app's replies by type */
function page({ answers = {}, native = true } = {})
{
    const sent = [];
    const browserQueries = [];
    const navigator = {
        standalone: false,
        geolocation: {},
        permissions: { query: async (descriptor) => { browserQueries.push(descriptor.name); return { state: 'prompt' }; } }
    };
    const window = { navigator };
    if (native)
    {
        window.webkit = { messageHandlers: { manhunt: { postMessage: async (message) =>
        {
            sent.push(message);
            const answer = answers[message.type];
            return typeof answer === 'function' ? answer(message) : answer ?? null;
        } } } };
    }
    const context = vm.createContext({ window, navigator, console, setTimeout, clearTimeout, Event, EventTarget, Promise, Date });
    vm.runInContext(source, context);
    return { window, navigator, sent, browserQueries, types: () => sent.map((message) => message.type) };
}

const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const FIX = { latitude: 39.19, longitude: -96.58, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null, timestamp: 1_700_000_000_000 };

test('does nothing outside the app', () =>
{
    const { window, navigator } = page({ native: false });
    assert.equal(window.__manhuntNative, undefined);
    assert.equal(navigator.standalone, false);
    assert.equal(navigator.wakeLock, undefined);
});

test('tells the web app it is the installed app', () =>
{
    assert.equal(page().navigator.standalone, true);
});

test('a watch runs the phone\'s location service until it is cleared', async () =>
{
    const { window, navigator, types } = page();
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

test('the service stays on while anything is still listening', () =>
{
    const { navigator, types } = page();
    const first = navigator.geolocation.watchPosition(() => {});
    const second = navigator.geolocation.watchPosition(() => {});
    navigator.geolocation.clearWatch(first);
    assert.ok(!types().includes('location-stop'));
    navigator.geolocation.clearWatch(second);
    assert.equal(types().filter((type) => type === 'location-start').length, 1);
    assert.equal(types().at(-1), 'location-stop');
});

test('getCurrentPosition answers once', () =>
{
    const { window, navigator, types } = page();
    const fixes = [];
    navigator.geolocation.getCurrentPosition((position) => fixes.push(position));
    window.__manhuntNative.location(FIX);
    window.__manhuntNative.location(FIX);
    assert.equal(fixes.length, 1);
    assert.equal(types().at(-1), 'location-stop');
});

test('a refusal reaches the web app as PERMISSION_DENIED, and a watch survives it', () =>
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

test('a timeout does not run while iOS is still asking', async () =>
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

test('a timeout runs at once when location is already allowed', async () =>
{
    const { navigator } = page({ answers: { 'permission-query': 'granted' } });
    await settle();
    const errors = [];
    navigator.geolocation.getCurrentPosition(() => {}, (error) => errors.push(error), { timeout: 10 });
    await settle(40);
    assert.equal(errors.length, 1);
});

test('a fix in time cancels the timeout', async () =>
{
    const { window, navigator } = page({ answers: { 'permission-query': 'granted' } });
    await settle();
    const errors = [];
    navigator.geolocation.watchPosition(() => {}, (error) => errors.push(error), { timeout: 20 });
    window.__manhuntNative.location(FIX);
    await settle(50);
    assert.equal(errors.length, 0);
});

test('a recent fix answers a new request at once', async () =>
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

test('the phone answers for location and the camera, the browser for the rest', async () =>
{
    const { navigator, sent, browserQueries } = page({ answers: { 'permission-query': (message) => (message.name === 'camera' ? 'denied' : 'granted') } });
    assert.equal((await navigator.permissions.query({ name: 'geolocation' })).state, 'granted');
    assert.equal((await navigator.permissions.query({ name: 'camera' })).state, 'denied');
    assert.equal((await navigator.permissions.query({ name: 'notifications' })).state, 'prompt');
    assert.deepEqual(browserQueries, ['notifications']);
    assert.ok(sent.some((message) => message.type === 'permission-query' && message.name === 'camera'));
});

test('a permission changed in Settings reaches the web app', async () =>
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

test('the screen stays on while any wake lock is held', async () =>
{
    const { navigator, sent } = page();
    const held = () => sent.filter((message) => message.type === 'wake-lock').map((message) => message.held);

    const first = await navigator.wakeLock.request('screen');
    const second = await navigator.wakeLock.request('screen');
    assert.deepEqual(held(), [true]);

    let released = 0;
    first.addEventListener('release', () => { released += 1; });
    await first.release();
    await first.release();
    assert.equal(released, 1);
    assert.equal(first.released, true);
    assert.deepEqual(held(), [true]);

    await second.release();
    assert.deepEqual(held(), [true, false]);
});
