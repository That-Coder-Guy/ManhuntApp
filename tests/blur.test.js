import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { formatHiderDistance } from '../src/utils/geo.js';
import { describeSettings, HIDER_BLUR_DEFAULT_M } from '../src/utils/game.js';

const require = createRequire(import.meta.url);
const {
    DEFAULT_SETTINGS, LIMITS, BLUR, applySettings, distanceMeters, hiderSpeed, nextBlurShare, blurredPosition
} = require('../server/game.js');

const START = { latitude: 39.19, longitude: -96.58 };
// The same "random" numbers every run
function seeded(seed)
{
    const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // (a small seed's first numbers are small too: skip them)
    for (let i = 0; i < 10; i++) next();
    return next;
}
const METRES_PER_DEGREE = 111_195;
// `metres` north of START
const north = (metres, from = START) => ({ latitude: from.latitude + metres / METRES_PER_DEGREE, longitude: from.longitude });
const east = (metres, from = START) => ({ latitude: from.latitude, longitude: from.longitude + metres / (METRES_PER_DEGREE * Math.cos((from.latitude * Math.PI) / 180)) });
// A fix every `everyS` seconds, going north at `speed` m/s, the last one at `now`
function walk(speed, seconds, now, everyS = 2)
{
    const fixes = [];
    for (let t = 0; t <= seconds; t += everyS) fixes.push({ ...north(speed * t), at: now - (seconds - t) * 1000 });
    return fixes;
}

test('a still hider is seen within 25 m by default, and the host can change or drop that', () => {
    assert.equal(DEFAULT_SETTINGS.hider_blur_m, 25);
    assert.equal(applySettings(DEFAULT_SETTINGS, { hider_blur_m: 0 }).settings.hider_blur_m, 0, '0: always exact');
    assert.equal(applySettings(DEFAULT_SETTINGS, { hider_blur_m: 250 }).settings.hider_blur_m, 250);
    for (const bad of [LIMITS.hiderBlurMinM - 1, LIMITS.hiderBlurMaxM + 1, 99.5, -100, '100', null, true]) {
        assert.ok(applySettings(DEFAULT_SETTINGS, { hider_blur_m: bad }).error, JSON.stringify(bad));
    }
});

test('speed is the ground actually covered, so wobble on the spot is standing still', () => {
    const now = 1_000_000_000;
    assert.equal(hiderSpeed([], now), 0, 'no fixes yet');
    assert.equal(hiderSpeed([{ ...START, at: now - 5000 }, { ...north(8), at: now }], now), 0, 'too little history to say they are moving');

    const walking = hiderSpeed(walk(1.4, 60, now), now);
    assert.ok(Math.abs(walking - 1.4) < 0.05, `walking pace: ${walking}`);
    assert.ok(Math.abs(hiderSpeed(walk(3, 60, now), now) - 3) < 0.1, 'running');

    // GPS noise: 6 m this way and that for a minute, going nowhere
    const wobble = Array.from({ length: 31 }, (_, i) => ({ ...(i % 2 ? north(6) : east(6)), at: now - (60 - i * 2) * 1000 }));
    assert.ok(hiderSpeed(wobble, now) < BLUR.steps[1][0], `wobble reads as still: ${hiderSpeed(wobble, now)}`);

    // Walked for a minute, then stood for ten seconds: the short look back says stopped
    const stopped = walk(1.4, 60, now - 10_000).concat([{ ...north(1.4 * 60), at: now }]);
    assert.ok(hiderSpeed(stopped, now) < 0.1, `stopped: ${hiderSpeed(stopped, now)}`);
    // Stopped reporting altogether (a phone standing still may send nothing): still
    assert.equal(hiderSpeed(walk(1.4, 60, now - 45_000), now), 0);
    // Only just set off at a run: not yet moving for long enough to be shown exactly
    const setOff = [{ ...START, at: now - 60_000 }, { ...START, at: now - 16_000 }, ...walk(3, 6, now)];
    assert.ok(hiderSpeed(setOff, now) < BLUR.exact_mps, `just set off: ${hiderSpeed(setOff, now)}`);
    // Fixes that don't fall on the window's edge: the speed is over the time between them, not the window
    const uneven = [{ ...START, at: now - 21_000 }, { ...north(21), at: now - 7_000 }, { ...north(42), at: now }];
    assert.ok(Math.abs(hiderSpeed(uneven, now) - 2) < 0.05, `uneven fixes: ${hiderSpeed(uneven, now)}`);
});

test('the radius halves as the speed doubles, and is nothing faster than an 11-minute mile', () => {
    const shareAt = (speed) => nextBlurShare(null, speed);
    const elevenMinuteMile = 1609.344 / (11 * 60);
    assert.ok(Math.abs(BLUR.exact_mps - elevenMinuteMile) < 1e-9 && Math.abs(elevenMinuteMile - 2.438) < 0.001);
    assert.deepEqual([0, 0.3, 0.6, 0.62, 1.2, 1.23, 2.4, 2.44, 3, 5].map(shareAt), [1, 1, 1, 0.5, 0.5, 0.25, 0.25, 0, 0, 0]);
    // A 10-minute mile is faster and exact; a 12-minute mile is not
    assert.equal(shareAt(1609.344 / 600), 0);
    assert.equal(shareAt(1609.344 / 720), 0.25);
    // Whatever the radius was, reaching that pace zeroes it at once: no margin on top
    for (const from of [1, 0.5, 0.25]) assert.equal(nextBlurShare(from, elevenMinuteMile + 0.001), 0, `from ${from}`);
    // Never the other way: faster is never vaguer
    for (let speed = 0, last = 1; speed < 3; speed += 0.05) {
        assert.ok(shareAt(speed) <= last, `at ${speed}`);
        last = shareAt(speed);
    }
});

test('a hider who breaks into a run is exact within seconds, and stays so while they keep it up', () => {
    const now = 1_000_000_000;
    // Stood for a minute, then eight seconds at 3 m/s
    const dash = [{ ...START, at: now - 70_000 }, { ...START, at: now - 10_000 }, ...walk(3, 8, now)];
    const steady = hiderSpeed(dash, now);
    const quick = hiderSpeed(dash, now, [BLUR.exact_window_ms]);
    assert.ok(steady < BLUR.exact_mps, `the longer look back isn't there yet: ${steady}`);
    assert.ok(Math.abs(quick - 3) < 0.05, `the last few seconds are: ${quick}`);
    assert.equal(nextBlurShare(1, steady, quick), 0, 'which is enough to be exact');
    // Holding the pace keeps it; easing a little under the line doesn't lose it at once
    assert.equal(nextBlurShare(0, 2.3, 2.3), 0);
    // Slowing to a walk does: the radius is then whatever the walk gives
    assert.equal(nextBlurShare(0, 1.4, 1.4), 0.25);
    // A walk is never exact, however long it lasts, and a few seconds of it don't even halve the radius
    assert.equal(nextBlurShare(1, 1.5, 1.5), 0.25);
    assert.equal(nextBlurShare(1, 0.4, 1.5), 1, 'the smaller steps go by the longer look back');
    // Wobble on the spot: 8 m between two fixes is nothing like a run
    const jump = [{ ...START, at: now - 60_000 }, { ...START, at: now - 7_000 }, { ...north(8), at: now }];
    assert.ok(hiderSpeed(jump, now, [BLUR.exact_window_ms]) < BLUR.exact_mps / 2);
});

test('a speed hovering at a threshold does not flip the radius back and forth', () => {
    // Reaching 0.61 m/s halves it
    assert.equal(nextBlurShare(1, 0.6), 1);
    assert.equal(nextBlurShare(1, 0.62), 0.5);
    // And once halved, dipping just under doesn't undo it; clearly under does
    assert.equal(nextBlurShare(0.5, 0.58), 0.5);
    assert.equal(nextBlurShare(0.5, 0.5), 1);
    // Exact is kept until clearly slower than the 11-minute mile
    assert.equal(nextBlurShare(0.25, 2.4), 0.25);
    assert.equal(nextBlurShare(0.25, 2.45), 0);
    assert.equal(nextBlurShare(0, 2.2), 0);
    assert.equal(nextBlurShare(0, 2.0), 0.25);
    // A sudden stop goes straight to the full radius
    assert.equal(nextBlurShare(0, 0), 1);
});

test('the point seekers get is always within the radius of the hider', () => {
    const random = seeded(7);
    for (let i = 0; i < 400; i++) {
        const radius = [6.25, 12.5, 25, 100, 500][i % 5];
        const position = { latitude: START.latitude + (random() - 0.5) * 0.02, longitude: START.longitude + (random() - 0.5) * 0.02 };
        const first = blurredPosition(position, radius, null, random);
        assert.equal(first.radius, radius);
        assert.ok(distanceMeters(position, first) <= radius, `fresh: ${distanceMeters(position, first)} of ${radius}`);
        // Wherever they go next, the circle they're given holds them
        const moved = east((random() - 0.5) * 3 * radius, north((random() - 0.5) * 3 * radius, position));
        const next = blurredPosition(moved, radius, first, random);
        assert.ok(distanceMeters(moved, next) <= radius, `moved: ${distanceMeters(moved, next)} of ${radius}`);
    }
});

test('the hider may be anywhere in their circle, not only near its middle', () => {
    const random = seeded(3);
    const radius = 25;
    // Where the hider is, measured from the centre of the circle they were given
    const offsets = Array.from({ length: 4000 }, () => {
        const circle = blurredPosition(START, radius, null, random);
        const northM = (START.latitude - circle.latitude) * METRES_PER_DEGREE;
        const eastM = (START.longitude - circle.longitude) * METRES_PER_DEGREE * Math.cos((START.latitude * Math.PI) / 180);
        return { out: Math.hypot(northM, eastM) / radius, eastM, northM };
    });
    const share = (test) => offsets.filter(test).length / offsets.length;
    const reach = 1 / (1 + BLUR.margin);
    assert.ok(offsets.every((o) => o.out <= reach + 0.001), 'a new circle is put down with the hider inside the margin');
    assert.ok(Math.max(...offsets.map((o) => o.out)) > reach - 0.02, 'right up to it');
    // Evenly by area: a quarter of the time within half the reach, and so on
    assert.ok(Math.abs(share((o) => o.out <= reach / 2) - 0.25) < 0.03, `inner half: ${share((o) => o.out <= reach / 2)}`);
    assert.ok(Math.abs(share((o) => o.out <= reach * 0.8) - 0.64) < 0.03);
    // In every direction alike, the corners a square would leave out included
    for (const [name, test] of [['north-east', (o) => o.eastM > 0 && o.northM > 0], ['north-west', (o) => o.eastM < 0 && o.northM > 0],
        ['south-east', (o) => o.eastM > 0 && o.northM < 0], ['south-west', (o) => o.eastM < 0 && o.northM < 0]]) {
        assert.ok(Math.abs(share(test) - 0.25) < 0.03, `${name}: ${share(test)}`);
    }
    // Further out than any square inside the circle reaches along its sides (0.71 of the radius)
    assert.ok(share((o) => Math.abs(o.eastM) > 0.75 * radius || Math.abs(o.northM) > 0.75 * radius) > 0.05, 'out past where a square\'s sides would be');
});

test('a hider who stays put gives seekers one point, however their position wobbles', () => {
    const random = seeded(5);
    const spot = blurredPosition(north(40), 100, null, random);
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
        const wobbled = east(Math.sin(i) * 6, north(40 + Math.cos(i * 1.7) * 6));
        const again = blurredPosition(wobbled, 100, spot, random);
        seen.add(`${again.latitude},${again.longitude}`);
    }
    assert.equal(seen.size, 1, 'nothing to average');
    assert.ok(distanceMeters(spot, north(40)) > 1, 'and that point is not where they are');
});

test('only walking out of a circle gets a new one', () => {
    const random = seeded(9);
    const circle = blurredPosition(START, 25, null, random);
    // Anywhere inside it, edge included: the same circle
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const radians = (bearing * Math.PI) / 180;
        const nearEdge = east(Math.sin(radians) * 24.5, north(Math.cos(radians) * 24.5, circle));
        assert.equal(blurredPosition(nearEdge, 25, circle, random), circle, `at ${bearing}°`);
    }
    // Just outside: another, which holds them, with them back inside the margin
    const outside = north(26, circle);
    const next = blurredPosition(outside, 25, circle, random);
    assert.notEqual(next, circle);
    assert.ok(distanceMeters(outside, next) <= 25 / (1 + BLUR.margin) + 0.01);
    assert.ok(distanceMeters(next, circle) > 1, 'somewhere else');
});

test('a smaller circle lies inside the bigger one, and a bigger one holds the smaller', () => {
    const random = seeded(11);
    for (let i = 0; i < 300; i++) {
        const [big, small] = [[100, 50], [50, 25], [25, 12.5], [25, 6.25], [100, 25]][i % 5];
        // The hider anywhere in the big circle, its edge included
        const centre = { latitude: START.latitude + (random() - 0.5) * 0.01, longitude: START.longitude + (random() - 0.5) * 0.01, radius: big };
        const bearing = random() * 2 * Math.PI;
        const out = (i % 7 === 0 ? 0.999 : Math.sqrt(random())) * big;
        const hider = east(Math.sin(bearing) * out, north(Math.cos(bearing) * out, centre));

        // Speeding up: the smaller circle is wholly inside the one already shown
        const inner = blurredPosition(hider, small, centre, random);
        assert.ok(distanceMeters(hider, inner) <= small + 0.01, `holds the hider: ${distanceMeters(hider, inner)} of ${small}`);
        assert.ok(distanceMeters(inner, centre) + small <= big + 0.01, `inside the old one: ${distanceMeters(inner, centre)} + ${small} of ${big}`);

        // Slowing down again: the bigger circle holds all of the smaller
        const outer = blurredPosition(hider, big, inner, random);
        assert.ok(distanceMeters(hider, outer) <= big + 0.01);
        assert.ok(distanceMeters(outer, inner) + small <= big + 0.01, `holds the old one: ${distanceMeters(outer, inner)} + ${small} of ${big}`);
    }
});

test('two hiders standing together are not shown at one point', () => {
    const random = seeded(13);
    const a = blurredPosition(START, 25, null, random);
    const b = blurredPosition(START, 25, null, random);
    assert.ok(distanceMeters(a, b) > 1);
});

test('the phone marks a vague position as one, and the summary names the setting', () => {
    assert.equal(HIDER_BLUR_DEFAULT_M, DEFAULT_SETTINGS.hider_blur_m, 'the phone and the server agree on the default');
    assert.equal(formatHiderDistance(120.4, 100), '≈\u202F120\u202Fm');
    assert.equal(formatHiderDistance(120.4, 0), '120\u202Fm');
    assert.equal(formatHiderDistance(120.4, undefined), '120\u202Fm', 'a server from before this');
    assert.equal(formatHiderDistance(null, 100), '—');
    assert.equal(describeSettings({}).hiderBlur, 'Still hiders ±25\u202Fm');
    assert.equal(describeSettings({ hider_blur_m: 250 }).hiderBlur, 'Still hiders ±250\u202Fm');
    assert.equal(describeSettings({ hider_blur_m: 0 }).hiderBlur, 'Exact hider positions');
});
