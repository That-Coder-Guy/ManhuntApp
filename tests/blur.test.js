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
const ORIGIN = { latitude: 39.1893, longitude: -96.5811 };
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

test('a still hider is seen within 100 m by default, and the host can change or drop that', () => {
    assert.equal(DEFAULT_SETTINGS.hider_blur_m, 100);
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
    // Only just set off: not yet moving for long enough to be shown exactly
    const setOff = [{ ...START, at: now - 60_000 }, { ...START, at: now - 12_000 }, ...walk(1.4, 10, now)];
    assert.ok(hiderSpeed(setOff, now) < BLUR.exact_mps, `just set off: ${hiderSpeed(setOff, now)}`);
});

test('the radius halves as the speed doubles, and is nothing from walking pace', () => {
    const shareAt = (speed) => nextBlurShare(null, speed);
    assert.deepEqual([0, 0.2, 0.3, 0.5, 0.6, 1.1, 1.2, 1.4, 4].map(shareAt), [1, 1, 0.5, 0.5, 0.25, 0.25, 0, 0, 0]);
    // Never the other way: faster is never vaguer
    for (let speed = 0, last = 1; speed < 3; speed += 0.05) {
        assert.ok(shareAt(speed) <= last, `at ${speed}`);
        last = shareAt(speed);
    }
});

test('a speed hovering at a threshold does not flip the radius back and forth', () => {
    // Just past 0.3 m/s isn't enough to halve it; clearly past is
    assert.equal(nextBlurShare(1, 0.31), 1);
    assert.equal(nextBlurShare(1, 0.4), 0.5);
    // And once halved, dipping just under doesn't undo it; clearly under does
    assert.equal(nextBlurShare(0.5, 0.29), 0.5);
    assert.equal(nextBlurShare(0.5, 0.2), 1);
    // Exact needs a clear walking pace, and is kept until clearly slower
    assert.equal(nextBlurShare(0.25, 1.25), 0.25);
    assert.equal(nextBlurShare(0.25, 1.5), 0);
    assert.equal(nextBlurShare(0, 1.1), 0);
    assert.equal(nextBlurShare(0, 0.9), 0.25);
    // A sudden stop goes straight to the full radius
    assert.equal(nextBlurShare(0, 0), 1);
});

test('the point seekers get is always within the radius of the hider', () => {
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 400; i++) {
        const radius = [25, 50, 100, 250, 500][i % 5];
        const position = { latitude: START.latitude + (random() - 0.5) * 0.02, longitude: START.longitude + (random() - 0.5) * 0.02 };
        const first = blurredPosition(position, radius, ORIGIN);
        assert.ok(distanceMeters(position, first) <= radius, `fresh: ${distanceMeters(position, first)} of ${radius}`);
        // Drifting up to the margin outside the square keeps the square, and is still within the radius
        const drifted = { latitude: position.latitude + (random() - 0.5) * 0.0004, longitude: position.longitude + (random() - 0.5) * 0.0004 };
        const kept = blurredPosition(drifted, radius, ORIGIN, first.cell);
        assert.ok(distanceMeters(drifted, kept) <= radius, `kept: ${distanceMeters(drifted, kept)} of ${radius}`);
    }
});

test('a hider who stays put gives seekers one point, however their position wobbles', () => {
    const spot = blurredPosition(north(40), 100, ORIGIN);
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
        const wobbled = east(Math.sin(i) * 8, north(40 + Math.cos(i * 1.7) * 8));
        const again = blurredPosition(wobbled, 100, ORIGIN, spot.cell);
        seen.add(`${again.latitude},${again.longitude}`);
    }
    assert.equal(seen.size, 1, 'nothing to average');
    assert.ok(distanceMeters(spot, north(40)) > 1, 'and that point is not where they are');
});

test('standing on a square\'s edge does not flicker between two squares', () => {
    // Find an edge: walk north until the square changes
    let before = blurredPosition(START, 100, ORIGIN);
    let metres = 0;
    for (; metres < 200; metres += 0.5) {
        const here = blurredPosition(north(metres), 100, ORIGIN);
        if (here.cell.row !== before.cell.row) break;
        before = here;
    }
    // A few metres either side of it, having started below: still the first square
    for (const offset of [-4, 3, -2, 5, 1, 8]) {
        assert.equal(blurredPosition(north(metres + offset), 100, ORIGIN, before.cell).cell.row, before.cell.row, `at ${offset} m`);
    }
    // Well past it: the next square
    assert.equal(blurredPosition(north(metres + 40), 100, ORIGIN, before.cell).cell.row, before.cell.row + 1);
});

test('smaller squares sit inside the bigger ones, so a change of radius gives no cross-check', () => {
    let seed = 11;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 200; i++) {
        const position = { latitude: START.latitude + (random() - 0.5) * 0.02, longitude: START.longitude + (random() - 0.5) * 0.02 };
        const [full, half, quarter] = [100, 50, 25].map((radius) => blurredPosition(position, radius, ORIGIN).cell);
        assert.equal(half.side * 2, full.side);
        assert.deepEqual([Math.floor(half.column / 2), Math.floor(half.row / 2)], [full.column, full.row]);
        assert.deepEqual([Math.floor(quarter.column / 2), Math.floor(quarter.row / 2)], [half.column, half.row]);
    }
});

test('each hider\'s grid lies somewhere else', () => {
    const other = { latitude: ORIGIN.latitude + 0.0004, longitude: ORIGIN.longitude - 0.0003 };
    const a = blurredPosition(START, 100, ORIGIN);
    const b = blurredPosition(START, 100, other);
    assert.ok(distanceMeters(a, b) > 1, 'two hiders standing together are not shown at one point');
});

test('the phone marks a vague position as one, and the summary names the setting', () => {
    assert.equal(HIDER_BLUR_DEFAULT_M, DEFAULT_SETTINGS.hider_blur_m, 'the phone and the server agree on the default');
    assert.equal(formatHiderDistance(120.4, 100), '≈\u202F120\u202Fm');
    assert.equal(formatHiderDistance(120.4, 0), '120\u202Fm');
    assert.equal(formatHiderDistance(120.4, undefined), '120\u202Fm', 'a server from before this');
    assert.equal(formatHiderDistance(null, 100), '—');
    assert.equal(describeSettings({}).hiderBlur, 'Still hiders ±100\u202Fm');
    assert.equal(describeSettings({ hider_blur_m: 250 }).hiderBlur, 'Still hiders ±250\u202Fm');
    assert.equal(describeSettings({ hider_blur_m: 0 }).hiderBlur, 'Exact hider positions');
});
