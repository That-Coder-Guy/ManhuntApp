import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLobbyId, lobbyPath } from '../src/utils/lobbyLink.js';
import { getTimeAgo, isStale } from '../src/utils/time.js';
import { playerFreshness, playerName } from '../src/utils/players.js';
import { formatDistance, calculateDistance, calculateBearing } from '../src/utils/geo.js';

const ID = '7b5a6422-5028-40b0-8fef-22301dfc7e97';

test('parseLobbyId accepts bare IDs and invite links', () => {
    assert.equal(parseLobbyId(ID), ID);
    assert.equal(parseLobbyId(`  ${ID.toUpperCase()}  `), ID);
    assert.equal(parseLobbyId(`https://tame-otter-plays-42.trycloudflare.com/lobby/${ID}`), ID);
    assert.equal(parseLobbyId(`http://localhost:3001/lobby/${ID}?ref=qr#x`), ID);
    assert.equal(parseLobbyId(`/lobby/${encodeURIComponent(ID)}`), ID);
});

test('parseLobbyId rejects anything that is not a lobby', () => {
    for (const bad of ['', '   ', 'hello', 'https://example.com/', '/lobby/', '/lobby/%E0%A4%A',
        '/lobby/constructor', `${ID}x`, null, undefined, 42]) {
        assert.equal(parseLobbyId(bad), null, JSON.stringify(bad));
    }
});

test('lobbyPath encodes the ID', () => {
    assert.equal(lobbyPath(ID), `/lobby/${ID}`);
});

test('getTimeAgo buckets', () => {
    const now = 1_000_000_000;
    assert.equal(getTimeAgo(null, now), '—');
    assert.equal(getTimeAgo(now + 5000, now), 'just now'); // clock skew
    assert.equal(getTimeAgo(now - 12_000, now), '12s ago');
    assert.equal(getTimeAgo(now - 4 * 60_000, now), '4m ago');
    assert.equal(getTimeAgo(now - 2 * 3_600_000, now), '2h ago');
});

test('isStale treats missing and old fixes as stale', () => {
    const now = 1_000_000_000;
    assert.equal(isStale(null, 30_000, now), true);
    assert.equal(isStale(now - 10_000, 30_000, now), false);
    assert.equal(isStale(now - 31_000, 30_000, now), true);
});

test('playerFreshness describes fresh, stale and offline players', () => {
    const now = 1_000_000_000;
    assert.deepEqual(playerFreshness({ location_last_updated: now - 12_000, connected: true }, now),
        { offline: false, jammed: false, fresh: true, label: 'updated 12s ago' });
    assert.deepEqual(playerFreshness({ location_last_updated: now - 120_000 }, now),
        { offline: false, jammed: false, fresh: false, label: 'updated 2m ago' });
    assert.deepEqual(playerFreshness({ location_last_updated: null, connected: false }, now),
        { offline: true, jammed: false, fresh: false, label: 'Offline · no location yet' });
    assert.equal(playerName({ player_id: 3 }), 'Player 3');
    assert.equal(playerName({ player_id: 3, name: 'Ana' }), 'Ana');
});

test('distances use one format', () => {
    assert.equal(formatDistance(null), '—');
    assert.equal(formatDistance(61.4), '61 m');
    assert.equal(formatDistance(999.4), '999 m');
    assert.equal(formatDistance(1234), '1.2 km');
});

test('geo helpers handle missing and zero coordinates', () => {
    assert.equal(calculateDistance(null, 0, 0, 0), null);
    assert.equal(calculateDistance(0, 0, 0, 0), 0); // 0 is a real coordinate
    assert.ok(Math.abs(calculateDistance(39.19, -96.58, 39.1918, -96.58) - 200) < 1);
    assert.ok(Math.abs(calculateBearing(39.19, -96.58, 39.2, -96.58)) < 0.01, 'due north');
    assert.ok(Math.abs(calculateBearing(0, 0, 0, 1) - 90) < 0.01, 'due east');
});

import { formatClock, formatDuration, formatArea, describeSettings, playAreaStatus, gameClock, foundStatus } from '../src/utils/game.js';
import { initials } from '../src/utils/avatar.js';

test('clock and duration formats', () => {
    assert.equal(formatClock(0), '0:00');
    assert.equal(formatClock(-5000), '0:00');
    assert.equal(formatClock(65_000), '1:05');
    assert.equal(formatClock(64_001), '1:05', 'rounds up so it never shows 0:00 early');
    assert.equal(formatClock(3_725_000), '1:02:05');
    assert.equal(formatDuration(0), 'None');
    assert.equal(formatDuration(0, 'No limit'), 'No limit');
    assert.equal(formatDuration(45), '45 s');
    assert.equal(formatDuration(1800), '30 min');
    assert.equal(formatDuration(5400), '1 h 30 min');
    assert.equal(formatDuration(7200), '2 h');
});

const square = [
    { latitude: 39.191, longitude: -96.581 }, { latitude: 39.191, longitude: -96.579 },
    { latitude: 39.189, longitude: -96.579 }, { latitude: 39.189, longitude: -96.581 },
];

test('settings summary', () => {
    assert.deepEqual(describeSettings({ geofence: null, time_limit_s: 0, head_start_s: 60 }),
        { playArea: 'Anywhere', timeLimit: 'No limit', headStart: '1 min', foundRange: '50\u202Fm', seekerInfo: 'Distance to nearest seeker', jamming: '1 min jam, 15 min charge', hiderBlur: 'Still hiders ±25\u202Fm' });
    assert.equal(describeSettings({ found_range_m: 100 }).foundRange, '100\u202Fm');
    assert.equal(describeSettings({ geofence: { points: square } }).playArea, '38,300\u202Fm²');
    assert.equal(formatArea(1_234_567), '1.2\u202Fkm²');
});

test('play area status', () => {
    const fence = { points: square };
    assert.equal(playAreaStatus(null, { latitude: 1, longitude: 1 }), null);
    assert.equal(playAreaStatus(fence, { latitude: null, longitude: null }), null);
    const inside = playAreaStatus(fence, { latitude: 39.1905, longitude: -96.58 });
    assert.equal(inside.outside, false);
    assert.ok(Math.abs(inside.distanceToEdge - 55.6) < 1);
    const out = playAreaStatus(fence, { latitude: 39.193, longitude: -96.58 }); // ~222 m north of the top edge
    assert.equal(out.outside, true);
    assert.equal(out.directionBack, 'S');
    assert.ok(Math.abs(out.distanceToEdge - 222.4) < 2);
    // East of the area: the way back is west, to the nearest edge
    assert.equal(playAreaStatus(fence, { latitude: 39.19, longitude: -96.575 }).directionBack, 'W');
});

test('game clock phases', () => {
    const game = { started_at: 0, head_start_ends_at: 60_000, ends_at: 660_000 };
    assert.deepEqual(gameClock(game, 10_000), { kind: 'head_start', remainingMs: 50_000 });
    assert.deepEqual(gameClock(game, 70_000), { kind: 'limit', remainingMs: 590_000 });
    assert.deepEqual(gameClock({ ...game, ends_at: null }, 70_000), { kind: 'open', elapsedMs: 10_000 });
    assert.equal(gameClock(null, 0), null);
});

test('initials for placeholder avatars', () => {
    assert.equal(initials('Maya'), 'MA');
    assert.equal(initials('Maya Lopez'), 'ML');
    assert.equal(initials('  ana  de  la cruz '), 'AC');
    assert.equal(initials(''), '?');
});

test('foundStatus works from the seeker info the server sends', () => {
    const now = 1_000_000;
    const me = { latitude: 39.19, longitude: -96.58 };
    const game = { head_start_ends_at: now - 1 };
    const away = (distance_m) => ({ mode: 'distance', distance_m });
    const status = (seekerInfo, extra = {}) => foundStatus({ game, settings: { found_range_m: 50 }, location: me, seekerInfo, serverNow: now, ...extra });

    assert.deepEqual(status(away(33)), { state: 'in_range', range: 50, distance: 33 });
    assert.equal(status(away(50)).state, 'in_range', 'the range is inclusive, as on the server');
    assert.equal(status(away(220)).state, 'out_of_range');
    assert.equal(status(away(null)).state, 'no_seeker');
    assert.equal(status(null).state, 'no_seeker', 'nothing from the server yet');
    assert.equal(status(away(33), { location: null }).state, 'no_fix');
    assert.equal(status(away(33), { game: { head_start_ends_at: now + 5000 } }).state, 'head_start');
    assert.equal(status(away(220), { settings: { found_range_m: 250 } }).state, 'in_range', "the host's range applies");
    assert.equal(status(away(33), { settings: {} }).range, 50, 'defaults to 50 m');
    // The button mustn't reveal what the host hides: always available, the server checks
    assert.equal(status({ mode: 'nearby', alert_m: 100, nearby: false }).state, 'unknown');
    assert.equal(status({ mode: 'none' }).state, 'unknown');
});

test('settings summary describes what hiders see', () => {
    assert.equal(describeSettings({}).seekerInfo, 'Distance to nearest seeker');
    // (within a found range that allows it: the alert never reaches further than that, see alert.test.js)
    assert.equal(describeSettings({ seeker_info: 'nearby', seeker_alert_m: 150, found_range_m: 200 }).seekerInfo, 'Alert within 150\u202Fm');
    assert.equal(describeSettings({ seeker_info: 'none' }).seekerInfo, 'Seekers hidden');
});

test('the version comes from git, or from the build where there is no checkout', async () => {
    const { readVersion } = await import('../shared/version.js');
    const { tmpdir } = await import('node:os');
    const { fileURLToPath } = await import('node:url');
    const here = readVersion(fileURLToPath(new URL('..', import.meta.url)), {});
    assert.match(here.commit, /^[0-9a-f]{7}$/, 'this repository: read from git, whatever the environment says');

    const passedIn = { MANHUNT_BUILD: '412', MANHUNT_COMMIT: '63269ad', MANHUNT_COMMIT_DATE: '2026-11-18T02:40:00-06:00' };
    assert.deepEqual(readVersion(tmpdir(), passedIn), { build: 412, commit: '63269ad', date: '2026-11-18T02:40:00-06:00' });
    assert.deepEqual(readVersion(tmpdir(), {}), { build: null, commit: 'unknown', date: null });
    assert.equal(readVersion(tmpdir(), { MANHUNT_BUILD: '', MANHUNT_COMMIT: '' }).commit, 'unknown', 'empty build arguments count as none');
    assert.equal(readVersion(tmpdir(), { MANHUNT_BUILD: '412', MANHUNT_COMMIT: 'not a commit' }).commit, 'unknown');
});

test('version line and mismatch check', async () => {
    const { formatVersion, isDifferentVersion } = await import('../src/utils/version.js');
    const v = { build: 60, commit: 'cb64839', date: '2026-11-17T10:00:00-06:00' };
    assert.equal(formatVersion(v), 'Version 60 · cb64839 · Nov 17, 2026');
    assert.equal(formatVersion(v, { withDate: false }), 'Version 60 · cb64839');
    assert.equal(formatVersion({ build: null, commit: 'unknown', date: null }), 'Version · unknown');
    assert.equal(isDifferentVersion(v, { ...v }), false);
    assert.equal(isDifferentVersion(v, { ...v, build: 61, commit: 'd4e5f6a' }), true);
    assert.equal(isDifferentVersion(v, null), false, 'an unreachable server is not a mismatch');
    assert.equal(isDifferentVersion(v, { commit: 'unknown' }), false, 'nor is one outside git');
});

test('the position filter steadies indoor GPS and still follows a walk outdoors', async () => {
    const { createPositionFilter } = await import('../src/utils/positionFilter.js');
    const { calculateDistance } = await import('../src/utils/geo.js');
    const SPOT = { latitude: 39.19, longitude: -96.58 };
    const M_PER_DEG_LAT = 111_320;
    const mPerDegLon = M_PER_DEG_LAT * Math.cos((SPOT.latitude * Math.PI) / 180);
    // A repeatable scatter: normal noise from a seeded generator
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
    const fix = (at, sd, t, accuracy = sd) => ({
        latitude: at.latitude + (normal() * sd) / M_PER_DEG_LAT,
        longitude: at.longitude + (normal() * sd) / mPerDegLon,
        accuracy, timestamp: t * 1000
    });
    const off = (p) => calculateDistance(SPOT.latitude, SPOT.longitude, p.latitude, p.longitude);

    // Sitting indoors: fixes scattered ~40 m, once a second
    const filter = createPositionFilter();
    let raw = 0;
    let steady = 0;
    let out;
    for (let t = 0; t < 120; t++) {
        const f = fix(SPOT, 40, t);
        out = filter.update(f);
        if (t >= 60) { raw += off(f); steady += off(out); }
    }
    raw /= 60; steady /= 60;
    assert.ok(raw > 35, `raw fixes are ~40 m off (${raw.toFixed(1)})`);
    assert.ok(steady < 12, `steadied ones are much closer (${steady.toFixed(1)} m)`);

    // Walking out of the building: good fixes 60 m away are followed quickly
    const outside = { latitude: SPOT.latitude + 60 / M_PER_DEG_LAT, longitude: SPOT.longitude };
    for (let t = 120; t < 126; t++) out = filter.update(fix(outside, 3, t, 5));
    assert.ok(calculateDistance(outside.latitude, outside.longitude, out.latitude, out.longitude) < 10, 'outside, it catches up within a few seconds');

    // Walking outdoors at 1.4 m/s: it stays close behind
    const walk = createPositionFilter();
    let worst = 0;
    for (let t = 0; t < 60; t++) {
        const at = { latitude: SPOT.latitude + (1.4 * t) / M_PER_DEG_LAT, longitude: SPOT.longitude };
        out = walk.update(fix(at, 3, t, 5));
        if (t > 10) worst = Math.max(worst, calculateDistance(at.latitude, at.longitude, out.latitude, out.longitude));
    }
    assert.ok(worst < 9, `a walking hider is shown within a few metres (${worst.toFixed(1)} m)`);

    // No accuracy given: treated as moderate, still a number out
    const plain = createPositionFilter().update({ latitude: 1, longitude: 2 });
    assert.deepEqual(plain, { latitude: 1, longitude: 2, accuracy: 30 });
});
