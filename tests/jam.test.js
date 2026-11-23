import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { jamView, jamSettings, describeSettings, JAM_DEFAULTS } from '../src/utils/game.js';
import { playerFreshness } from '../src/utils/players.js';

const require = createRequire(import.meta.url);
const { DEFAULT_SETTINGS, LIMITS, applySettings, jamStatus, isJamming } = require('../server/game.js');

const MIN = 60_000;
// A game whose seekers set off at t = 0
const GAME = { head_start_ends_at: 0 };

test('jamming is on by default: a minute long, fifteen minutes to charge', () => {
    assert.equal(DEFAULT_SETTINGS.jam_enabled, true);
    assert.equal(DEFAULT_SETTINGS.jam_duration_s, 60);
    assert.equal(DEFAULT_SETTINGS.jam_charge_s, 15 * 60);
    // The phone's copy of the defaults says the same
    assert.deepEqual(JAM_DEFAULTS, { enabled: true, duration_s: 60, charge_s: 900 });
    assert.deepEqual(jamSettings(null), JAM_DEFAULTS);
    assert.deepEqual(jamSettings({ jam_enabled: false, jam_duration_s: 30 }), { enabled: false, duration_s: 30, charge_s: 900 });
});

test('the host can turn jamming off and set both times, within limits', () => {
    const changed = applySettings(DEFAULT_SETTINGS, { jam_enabled: false, jam_duration_s: 30, jam_charge_s: 300 });
    assert.deepEqual(
        { enabled: changed.settings.jam_enabled, duration: changed.settings.jam_duration_s, charge: changed.settings.jam_charge_s },
        { enabled: false, duration: 30, charge: 300 }
    );
    assert.equal(changed.settings.found_range_m, DEFAULT_SETTINGS.found_range_m, 'and nothing else moves');

    for (const bad of [
        { jam_enabled: 'yes' }, { jam_enabled: 1 }, { jam_enabled: null },
        { jam_duration_s: LIMITS.jamDurationMinS - 1 }, { jam_duration_s: LIMITS.jamDurationMaxS + 1 }, { jam_duration_s: 45.5 }, { jam_duration_s: '60' },
        { jam_charge_s: LIMITS.jamChargeMinS - 1 }, { jam_charge_s: LIMITS.jamChargeMaxS + 1 }, { jam_charge_s: 0 }, { jam_charge_s: null }
    ]) {
        assert.ok(applySettings(DEFAULT_SETTINGS, bad).error, JSON.stringify(bad));
    }
});

test('a jammer charges from the seekers\' release, runs, then charges again', () => {
    const maya = {};
    const charging = jamStatus(DEFAULT_SETTINGS, GAME, maya, 14 * MIN);
    assert.deepEqual(charging, { enabled: true, state: 'charging', until: null, ready_at: 15 * MIN, duration_s: 60, charge_s: 900 });
    assert.equal(jamStatus(DEFAULT_SETTINGS, GAME, maya, 15 * MIN).state, 'ready');

    // Set off at 20:00 (what the server records)
    maya.jam_until = 21 * MIN;
    maya.jam_ready_at = 36 * MIN;
    const active = jamStatus(DEFAULT_SETTINGS, GAME, maya, 20 * MIN + 30_000);
    assert.equal(active.state, 'active');
    assert.equal(active.until, 21 * MIN);
    assert.ok(isJamming(maya, 20 * MIN + 30_000));
    // Over: charging again, for the full fifteen minutes from the end of the jam
    assert.ok(!isJamming(maya, 21 * MIN));
    assert.deepEqual(
        [jamStatus(DEFAULT_SETTINGS, GAME, maya, 21 * MIN).state, jamStatus(DEFAULT_SETTINGS, GAME, maya, 36 * MIN - 1).state, jamStatus(DEFAULT_SETTINGS, GAME, maya, 36 * MIN).state],
        ['charging', 'charging', 'ready']
    );
});

test('the head start counts for nothing, and seekers never jam', () => {
    const afterHeadStart = { head_start_ends_at: 5 * MIN };
    assert.equal(jamStatus(DEFAULT_SETTINGS, afterHeadStart, {}, 2 * MIN).ready_at, 20 * MIN, 'charging starts when the seekers set off');
    assert.ok(!isJamming({ is_seeker: true, jam_until: 10 * MIN }, MIN), 'a found hider\'s jam is over');
});

test('with jamming off there is no jammer, on the server or the phone', () => {
    const off = { ...DEFAULT_SETTINGS, jam_enabled: false };
    assert.deepEqual(jamStatus(off, GAME, {}, 30 * MIN), { enabled: false });
    assert.equal(jamView({ enabled: false }, 30 * MIN), null);
    assert.equal(jamView(null, 0), null);
    // Settings from before jamming existed behave as the defaults
    assert.equal(jamStatus({}, GAME, {}, 16 * MIN).state, 'ready');
});

test('the phone follows the jammer between updates, by the server\'s clock', () => {
    const jam = { enabled: true, until: null, ready_at: 15 * MIN, duration_s: 60, charge_s: 900 };
    assert.deepEqual(jamView(jam, 0), { state: 'charging', remainingMs: 15 * MIN, progress: 0 });
    assert.deepEqual(jamView(jam, 7.5 * MIN), { state: 'charging', remainingMs: 7.5 * MIN, progress: 0.5 });
    assert.deepEqual(jamView(jam, 15 * MIN), { state: 'ready', progress: 1 });
    // During a head start the charge hasn't begun: empty, not negative
    assert.equal(jamView({ ...jam, ready_at: 20 * MIN }, 0).progress, 0);

    const running = { ...jam, until: 21 * MIN, ready_at: 36 * MIN };
    assert.deepEqual(jamView(running, 20 * MIN + 15_000), { state: 'active', remainingMs: 45_000, progress: 0.75 });
    // The last update said "active"; a minute later the phone knows it's over
    assert.equal(jamView(running, 21 * MIN).state, 'charging');
    assert.equal(jamView(running, 21 * MIN).progress, 0);
});

test('the settings summary and the player lines say what jamming is doing', () => {
    assert.equal(describeSettings({}).jamming, '1 min jam, 15 min charge');
    assert.equal(describeSettings({ jam_duration_s: 30, jam_charge_s: 300 }).jamming, '30 s jam, 5 min charge');
    assert.equal(describeSettings({ jam_enabled: false }).jamming, 'No jamming');

    const now = 1_000_000_000;
    // A jamming hider has no position for anyone else: never fresh, and the list of players just says so
    assert.deepEqual(playerFreshness({ location_last_updated: null, connected: true, jammed_until: now + 40_000 }, now),
        { offline: false, jammed: true, fresh: false, label: 'Jamming' });
    assert.equal(playerFreshness({ location_last_updated: now - 12_000, jammed_until: now + 1 }, now).label, 'Jamming', 'no "last seen": there is nothing to have seen');
    assert.equal(playerFreshness({ location_last_updated: now, jammed_until: null }, now).jammed, false);
});
