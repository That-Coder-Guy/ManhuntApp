import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    headingFromEuler,
    applyScreenRotation,
    smoothHeading,
    bearingToCardinal
} from '../src/utils/orientation.js';

function assertClose(actual, expected, message)
{
    assert.ok(actual != null, `${message} (got null)`);
    // Compare on the circle so 359.9999 ≈ 0
    let diff = Math.abs(actual - expected) % 360;
    if (diff > 180) diff = 360 - diff;
    assert.ok(diff < 1e-9, `${message}: expected ~${expected}, got ${actual}`);
}

test('headingFromEuler: flat device pointing north (alpha=0) → heading 0', () => {
    assertClose(headingFromEuler(0, 0), 0, 'north');
});

test('headingFromEuler: alpha is counterclockwise — alpha=90 means top points WEST (heading 270)', () => {
    // This is the classic Android bug: using alpha directly would say 90 (east)
    assertClose(headingFromEuler(90, 0), 270, 'west');
});

test('headingFromEuler: alpha=270 → heading 90 (east)', () => {
    assertClose(headingFromEuler(270, 0), 90, 'east');
});

test('headingFromEuler: alpha=180 → heading 180 (south)', () => {
    assertClose(headingFromEuler(180, 0), 180, 'south');
});

test('headingFromEuler: pitch does not change azimuth while below vertical', () => {
    assertClose(headingFromEuler(0, 45), 0, 'tilted north');
    assertClose(headingFromEuler(90, 45), 270, 'tilted west');
    assertClose(headingFromEuler(90, -45), 270, 'tilted toward user');
});

test('headingFromEuler: near-vertical device is unusable → null', () => {
    assert.equal(headingFromEuler(0, 90), null);
    assert.equal(headingFromEuler(120, 85), null);
    assert.equal(headingFromEuler(120, 95), null);
});

test('headingFromEuler: tipped past vertical flips the projection', () => {
    // beta=180: device flat but face-down; top edge points opposite to alpha=0 north?
    // top of device: east=0, north=cos(0)*cos(180)=-1 → heading 180
    assertClose(headingFromEuler(0, 180), 180, 'face-down');
});

test('headingFromEuler: missing alpha → null', () => {
    assert.equal(headingFromEuler(null, 0), null);
    assert.equal(headingFromEuler(undefined, 0), null);
});

test('applyScreenRotation wraps correctly', () => {
    assertClose(applyScreenRotation(350, 90), 80, 'wrap');
    assertClose(applyScreenRotation(10, 0), 10, 'identity');
    assertClose(applyScreenRotation(0, 270), 270, 'landscape');
    assert.equal(applyScreenRotation(null, 90), null);
});

test('smoothHeading crosses the 0/360 seam the short way', () => {
    assertClose(smoothHeading(359, 1, 0.5), 0, 'seam midpoint');
    // Vector interpolation is not exactly linear in angle — assert it moved
    // partway toward the seam (into (350, 360)) rather than the long way round
    const nearSeam = smoothHeading(350, 10, 0.25);
    assert.ok(nearSeam > 350 && nearSeam < 360,
        `expected partway across the seam (350..360), got ${nearSeam}`);
});

test('smoothHeading edge behavior', () => {
    assertClose(smoothHeading(null, 45), 45, 'no previous → take next');
    assert.equal(smoothHeading(10, null), 10, 'no next → keep previous');
    assertClose(smoothHeading(0, 90, 1), 90, 'factor 1 → no smoothing');
    // Exactly opposite headings can't be averaged — takes the new one
    assertClose(smoothHeading(0, 180, 0.5), 180, 'opposite headings');
});

test('smoothHeading interpolates on the circle', () => {
    const s = smoothHeading(0, 90, 0.3);
    const expected = Math.atan2(0.3, 0.7) * 180 / Math.PI; // ≈ 23.2°
    assertClose(s, expected, 'vector interpolation');
});

test('bearingToCardinal buckets', () => {
    assert.equal(bearingToCardinal(0), 'N');
    assert.equal(bearingToCardinal(359), 'N');
    assert.equal(bearingToCardinal(22), 'N');
    assert.equal(bearingToCardinal(23), 'NE');
    assert.equal(bearingToCardinal(44), 'NE');
    assert.equal(bearingToCardinal(90), 'E');
    assert.equal(bearingToCardinal(135), 'SE');
    assert.equal(bearingToCardinal(180), 'S');
    assert.equal(bearingToCardinal(225), 'SW');
    assert.equal(bearingToCardinal(270), 'W');
    assert.equal(bearingToCardinal(315), 'NW');
    assert.equal(bearingToCardinal(null), null);
});
