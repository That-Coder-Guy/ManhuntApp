import { calculateBearing } from './geo.js';
import { bearingToCardinal } from './orientation.js';
import { pointInPolygon, nearestBoundaryPoint, polygonArea } from '../../shared/geofence.js';

/** "4:05", or "1:04:05" past an hour; negative times read as 0:00 */
export function formatClock(ms)
{
    const total = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** "30 min", "1 h 30 min", "45 s", or the fallback for zero */
export function formatDuration(seconds, zero = 'None')
{
    if (!seconds) return zero;
    if (seconds < 60) return `${seconds} s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    if (!hours) return `${minutes} min`;
    return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

/** "38,500 m²" below a square kilometre, "1.2 km²" above */
export function formatArea(squareMetres)
{
    if (squareMetres < 1_000_000)
    {
        return `${(Math.round(squareMetres / 100) * 100).toLocaleString('en-US')}\u202Fm²`;
    }
    return `${(squareMetres / 1_000_000).toFixed(1)}\u202Fkm²`;
}

/** One-line descriptions of each setting, for the summary card */
export function describeSettings(settings)
{
    const fence = settings?.geofence;
    return {
        playArea: fence ? `${formatArea(polygonArea(fence.points))} area` : 'Anywhere',
        timeLimit: formatDuration(settings?.time_limit_s, 'No limit'),
        headStart: formatDuration(settings?.head_start_s)
    };
}

/**
 * Where a position stands against the play area: inside or not, how far the
 * nearest edge is, and (outside) which way leads straight back in. Null when
 * there is no play area or no position.
 */
export function playAreaStatus(geofence, location)
{
    if (!geofence || location?.latitude == null || location?.longitude == null) return null;

    const { distance, point } = nearestBoundaryPoint(location, geofence.points);
    return {
        outside: !pointInPolygon(location, geofence.points),
        distanceToEdge: distance,
        directionBack: bearingToCardinal(calculateBearing(location.latitude, location.longitude, point.latitude, point.longitude))
    };
}

/**
 * The clock a player should see right now, using the server's time.
 *   { kind: 'head_start', remainingMs } — seekers are waiting
 *   { kind: 'limit', remainingMs }      — the hunt, with a time limit
 *   { kind: 'open', elapsedMs }         — the hunt, no limit
 */
export function gameClock(game, serverNow)
{
    if (!game) return null;
    if (serverNow < game.head_start_ends_at) return { kind: 'head_start', remainingMs: game.head_start_ends_at - serverNow };
    if (game.ends_at) return { kind: 'limit', remainingMs: game.ends_at - serverNow };
    return { kind: 'open', elapsedMs: serverNow - game.head_start_ends_at };
}
