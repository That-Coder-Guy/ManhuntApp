import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointInPolygon, nearestBoundaryPoint, isSimplePolygon, polygonArea, polygonProblem } from '../shared/geofence.js';

// ~222 m (north-south) by ~173 m (east-west) rectangle around 39.19, -96.58
const square = [
    { latitude: 39.191, longitude: -96.581 }, { latitude: 39.191, longitude: -96.579 },
    { latitude: 39.189, longitude: -96.579 }, { latitude: 39.189, longitude: -96.581 },
];
// An L shape: the notch in the top right is outside
const ell = [
    { latitude: 39.192, longitude: -96.582 }, { latitude: 39.192, longitude: -96.580 },
    { latitude: 39.190, longitude: -96.580 }, { latitude: 39.190, longitude: -96.578 },
    { latitude: 39.188, longitude: -96.578 }, { latitude: 39.188, longitude: -96.582 },
];

test('point in polygon, including a concave shape', () => {
    assert.equal(pointInPolygon({ latitude: 39.19, longitude: -96.58 }, square), true);
    assert.equal(pointInPolygon({ latitude: 39.2, longitude: -96.58 }, square), false);
    assert.equal(pointInPolygon({ latitude: 39.189, longitude: -96.581 }, ell), true, 'lower left arm');
    assert.equal(pointInPolygon({ latitude: 39.191, longitude: -96.579 }, ell), false, 'the notch is outside');
});

test('nearest boundary point and distance', () => {
    const inside = nearestBoundaryPoint({ latitude: 39.1905, longitude: -96.58 }, square);
    assert.ok(Math.abs(inside.distance - 55.6) < 1, `~56 m to the north edge, got ${inside.distance}`);
    assert.ok(Math.abs(inside.point.latitude - 39.191) < 1e-6);

    const outside = nearestBoundaryPoint({ latitude: 39.193, longitude: -96.58 }, square);
    assert.ok(Math.abs(outside.distance - 222.4) < 2, `~222 m back, got ${outside.distance}`);
    assert.ok(Math.abs(outside.point.longitude - -96.58) < 1e-6, 'straight back south');
});

test('simple polygon check catches crossing edges', () => {
    assert.equal(isSimplePolygon(square), true);
    assert.equal(isSimplePolygon(ell), true);
    assert.equal(isSimplePolygon([square[0], square[2], square[1], square[3]]), false, 'bow tie');
});

test('area', () => {
    const area = polygonArea(square);
    assert.ok(Math.abs(area - 222.4 * 172.4) / area < 0.01, `~38,000 m², got ${area}`);
});

test('polygon problems', () => {
    assert.equal(polygonProblem(square), null);
    assert.equal(polygonProblem(square.slice(0, 2)), 'Add at least 3 corners');
    assert.equal(polygonProblem('x'), 'Play area is invalid');
    assert.equal(polygonProblem([...square.slice(0, 3), { latitude: 'a', longitude: 0 }]), 'A corner has an invalid position');
    assert.match(polygonProblem([square[0], square[2], square[1], square[3]]), /edges cross/);
    assert.equal(polygonProblem([square[0], square[1], { latitude: 40.5, longitude: -96.58 }]), 'The play area is too large');
    assert.equal(polygonProblem([square[0], square[0], square[0]]), 'The play area has no size', 'all corners in one spot');
});
