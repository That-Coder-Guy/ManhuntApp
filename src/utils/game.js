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

// Mirrors the server (server/game.js): the defaults for the found range and
// for what hiders learn about the seekers
export const FOUND_RANGE_DEFAULT_M = 50;
export const SEEKER_INFO_DEFAULT = 'distance';
export const SEEKER_ALERT_DEFAULT_M = 100;

/** One-line descriptions of each setting, for the summary card */
export function describeSettings(settings)
{
    const fence = settings?.geofence;
    return {
        playArea: fence ? formatArea(polygonArea(fence.points)) : 'Anywhere',
        timeLimit: formatDuration(settings?.time_limit_s, 'No limit'),
        headStart: formatDuration(settings?.head_start_s),
        foundRange: `${settings?.found_range_m ?? FOUND_RANGE_DEFAULT_M}\u202Fm`,
        seekerInfo: {
            distance: 'Distance to nearest seeker',
            nearby: `Alert within ${settings?.seeker_alert_m ?? SEEKER_ALERT_DEFAULT_M}\u202Fm`,
            none: 'Seekers hidden'
        }[settings?.seeker_info ?? SEEKER_INFO_DEFAULT]
    };
}

/**
 * Whether this hider can declare themselves found right now. The server
 * decides in the end; this only says what the phone can tell beforehand:
 *   { state: 'head_start' }                     seekers are still waiting
 *   { state: 'no_fix', range }                  no position for this phone yet
 *   { state: 'no_seeker', range }               no seeker has a recent position
 *   { state: 'in_range' | 'out_of_range', range, distance }
 *   { state: 'unknown', range }                 the host keeps seekers' distance
 *                                               from hiders: tap when caught
 * `seekerInfo` is the hider's view the server sends; `serverNow` is the
 * server's clock (Date.now() + clockOffset).
 */
export function foundStatus({ game, settings, location, seekerInfo, serverNow })
{
    const range = settings?.found_range_m ?? FOUND_RANGE_DEFAULT_M;
    if (game && serverNow < game.head_start_ends_at) return { state: 'head_start', range };
    if (location?.latitude == null || location?.longitude == null) return { state: 'no_fix', range };
    // Only the distance mode tells a hider how close the seekers are; the
    // button mustn't give away what the host chose to hide
    if ((seekerInfo?.mode ?? SEEKER_INFO_DEFAULT) !== 'distance') return { state: 'unknown', range };
    const distance = seekerInfo?.distance_m ?? null;
    if (distance === null) return { state: 'no_seeker', range };
    return { state: distance <= range ? 'in_range' : 'out_of_range', range, distance };
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
