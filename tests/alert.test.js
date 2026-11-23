import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { alertDistance, describeSettings, SEEKER_ALERT_DEFAULT_M, FOUND_RANGE_DEFAULT_M } from '../src/utils/game.js';

const require = createRequire(import.meta.url);
const { DEFAULT_SETTINGS, applySettings, seekerInfoFor } = require('../server/game.js');

const change = (from, update) => applySettings(from, update).settings;

test('where an alert is all hiders get, it never reaches further than the found range', () => {
    // The defaults: found within 50 m, alert at 100 m. Turning the alert on brings it down to 50
    const nearby = change(DEFAULT_SETTINGS, { seeker_info: 'nearby' });
    assert.deepEqual([nearby.found_range_m, nearby.seeker_alert_m], [50, 50]);

    // Asked for further than the range: brought down to it. Within it: kept
    assert.equal(change(nearby, { seeker_alert_m: 300 }).seeker_alert_m, 50);
    assert.equal(change(nearby, { seeker_alert_m: 25 }).seeker_alert_m, 25);
    assert.equal(change(nearby, { seeker_alert_m: 50 }).seeker_alert_m, 50, 'the same size is allowed');

    // Whichever of the two is changed, and both at once
    const wide = change(nearby, { found_range_m: 200, seeker_alert_m: 150 });
    assert.deepEqual([wide.found_range_m, wide.seeker_alert_m], [200, 150]);
    assert.equal(change(wide, { found_range_m: 100 }).seeker_alert_m, 100, 'narrowing the range narrows the alert');
    assert.equal(change(wide, { found_range_m: 10 }).seeker_alert_m, 10, 'down to the smallest range there is');
    assert.equal(change(wide, { found_range_m: 300 }).seeker_alert_m, 150, 'widening it leaves the alert alone');
    assert.equal(change(DEFAULT_SETTINGS, { seeker_info: 'nearby', found_range_m: 75, seeker_alert_m: 500 }).seeker_alert_m, 75);
});

test('in the other modes the alert distance isn\'t used, and is left as it was', () => {
    assert.equal(DEFAULT_SETTINGS.seeker_alert_m, 100, 'the default, with hiders shown the distance');
    assert.equal(change(DEFAULT_SETTINGS, { seeker_alert_m: 300 }).seeker_alert_m, 300);
    assert.equal(change(DEFAULT_SETTINGS, { seeker_info: 'none', seeker_alert_m: 300, found_range_m: 25 }).seeker_alert_m, 300);
    // Until the alert is turned on
    const later = change(change(DEFAULT_SETTINGS, { seeker_alert_m: 300 }), { seeker_info: 'nearby' });
    assert.equal(later.seeker_alert_m, 50);
    // What isn't a distance is still refused, in any mode
    for (const bad of [9, 1001, 99.5, '100', null]) assert.ok(applySettings(DEFAULT_SETTINGS, { seeker_info: 'nearby', seeker_alert_m: bad }).error, JSON.stringify(bad));
});

test('the alert a hider gets, and the phone\'s own sums, keep to it too', () => {
    const hider = { latitude: 39.19, longitude: -96.58 };
    const seekerAt = (metresNorth) => [{ is_seeker: true, latitude: 39.19 + metresNorth / 111_195, longitude: -96.58, location_last_updated: 1000 }];
    // Settings that never went through applySettings (an old lobby): the alert still stops at the found range
    const old = { seeker_info: 'nearby', seeker_alert_m: 200, found_range_m: 50 };
    assert.deepEqual(seekerInfoFor(old, hider, seekerAt(120), 1000), { mode: 'nearby', alert_m: 50, nearby: false });
    assert.deepEqual(seekerInfoFor(old, hider, seekerAt(40), 1000), { mode: 'nearby', alert_m: 50, nearby: true });

    assert.equal(alertDistance(old), 50);
    assert.equal(alertDistance({ seeker_alert_m: 25, found_range_m: 50 }), 25);
    assert.equal(alertDistance({}), Math.min(SEEKER_ALERT_DEFAULT_M, FOUND_RANGE_DEFAULT_M));
    assert.equal(alertDistance(null), 50);
    assert.equal(describeSettings(old).seekerInfo, 'Alert within 50 m');
    assert.equal(describeSettings({ seeker_info: 'nearby', seeker_alert_m: 150, found_range_m: 300 }).seekerInfo, 'Alert within 150 m');
});
