/**
 * Play-area geometry, shared by the app and the server so both agree on
 * who is inside. A play area is a polygon of { latitude, longitude } corners.
 *
 * Areas are at most a few km across, so positions are projected onto a flat
 * plane (metres east/north of the first corner). The error at that size is
 * far below GPS accuracy.
 */

export const POLYGON_LIMITS = Object.freeze({
    minCorners: 3,
    maxCorners: 30,
    maxSpanM: 25_000, // every corner within this of the first
});

const EARTH_RADIUS_M = 6371e3;
const RAD = Math.PI / 180;

const isCoordinate = (value, limit) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

/** Projector to and from local metres around an origin */
function localFrame(origin)
{
    const cosLat = Math.cos(origin.latitude * RAD);
    return {
        toXY: (p) => ({
            x: (p.longitude - origin.longitude) * RAD * EARTH_RADIUS_M * cosLat,
            y: (p.latitude - origin.latitude) * RAD * EARTH_RADIUS_M
        }),
        toLatLng: ({ x, y }) => ({
            latitude: origin.latitude + y / (RAD * EARTH_RADIUS_M),
            longitude: origin.longitude + x / (RAD * EARTH_RADIUS_M * cosLat)
        })
    };
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function onSegment(p, a, b)
{
    return Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x)
        && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
}

// Do segments a-b and c-d touch or cross?
function segmentsIntersect(a, b, c, d)
{
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    return (d1 === 0 && onSegment(a, c, d)) || (d2 === 0 && onSegment(b, c, d))
        || (d3 === 0 && onSegment(c, a, b)) || (d4 === 0 && onSegment(d, a, b));
}

/** True when no two edges cross (adjacent edges sharing a corner are fine) */
export function isSimplePolygon(points)
{
    const { toXY } = localFrame(points[0]);
    const xy = points.map(toXY);
    const n = xy.length;
    for (let i = 0; i < n; i++)
    {
        for (let j = i + 1; j < n; j++)
        {
            // Skip edges that share a corner
            if (j === i + 1 || (i === 0 && j === n - 1)) continue;
            if (segmentsIntersect(xy[i], xy[(i + 1) % n], xy[j], xy[(j + 1) % n])) return false;
        }
    }
    return true;
}

/** Area in square metres */
export function polygonArea(points)
{
    const { toXY } = localFrame(points[0]);
    const xy = points.map(toXY);
    let twice = 0;
    for (let i = 0; i < xy.length; i++)
    {
        const a = xy[i];
        const b = xy[(i + 1) % xy.length];
        twice += a.x * b.y - b.x * a.y;
    }
    return Math.abs(twice) / 2;
}

/** Why these corners can't be a play area, or null when they can */
export function polygonProblem(points)
{
    if (!Array.isArray(points)) return 'Play area is invalid';
    if (points.length < POLYGON_LIMITS.minCorners) return `Add at least ${POLYGON_LIMITS.minCorners} corners`;
    if (points.length > POLYGON_LIMITS.maxCorners) return `Use at most ${POLYGON_LIMITS.maxCorners} corners`;
    if (!points.every((p) => p && isCoordinate(p.latitude, 90) && isCoordinate(p.longitude, 180))) return 'A corner has an invalid position';

    const { toXY } = localFrame(points[0]);
    if (points.some((p) => Math.hypot(toXY(p).x, toXY(p).y) > POLYGON_LIMITS.maxSpanM)) return 'The play area is too large';
    if (!isSimplePolygon(points)) return 'The edges cross. Move a corner so they don’t';
    if (polygonArea(points) < 1) return 'The play area has no size';
    return null;
}

/** Ray casting: is the position inside the polygon? */
export function pointInPolygon(position, points)
{
    const { toXY } = localFrame(points[0]);
    const p = toXY(position);
    const xy = points.map(toXY);
    let inside = false;
    for (let i = 0, j = xy.length - 1; i < xy.length; j = i++)
    {
        const a = xy[i];
        const b = xy[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

/** The closest point on the polygon's edge, and how far away it is in metres */
export function nearestBoundaryPoint(position, points)
{
    const frame = localFrame(points[0]);
    const p = frame.toXY(position);
    const xy = points.map(frame.toXY);

    let best = { distance: Infinity, point: null };
    for (let i = 0; i < xy.length; i++)
    {
        const a = xy[i];
        const b = xy[(i + 1) % xy.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0;
        const q = { x: a.x + t * dx, y: a.y + t * dy };
        const distance = Math.hypot(p.x - q.x, p.y - q.y);
        if (distance < best.distance) best = { distance, point: q };
    }
    return { distance: best.distance, point: frame.toLatLng(best.point) };
}
