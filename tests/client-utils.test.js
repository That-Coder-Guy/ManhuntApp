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
        { offline: false, fresh: true, label: 'updated 12s ago' });
    assert.deepEqual(playerFreshness({ location_last_updated: now - 120_000 }, now),
        { offline: false, fresh: false, label: 'updated 2m ago' });
    assert.deepEqual(playerFreshness({ location_last_updated: null, connected: false }, now),
        { offline: true, fresh: false, label: 'Offline · no location yet' });
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
