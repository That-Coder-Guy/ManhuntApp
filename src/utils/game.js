import { calculateDistance, calculateBearing, formatDistance } from './geo.js';
import { bearingToCardinal } from './orientation.js';

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

/** One-line descriptions of each setting, for the summary card */
export function describeSettings(settings)
{
    const fence = settings?.geofence;
    return {
        playArea: fence ? `${formatDistance(fence.radius_m)} radius` : 'Anywhere',
        timeLimit: formatDuration(settings?.time_limit_s, 'No limit'),
        headStart: formatDuration(settings?.head_start_s)
    };
}

/**
 * Where a position stands against the play area: inside or not, and the way
 * back to the centre. Null when there is no play area or no position.
 */
export function playAreaStatus(geofence, location)
{
    if (!geofence || location?.latitude == null || location?.longitude == null) return null;

    const fromCentre = calculateDistance(geofence.latitude, geofence.longitude, location.latitude, location.longitude);
    const outside = fromCentre > geofence.radius_m;
    return {
        outside,
        // Inside: room to the edge. Outside: how far back in.
        distanceToEdge: Math.abs(geofence.radius_m - fromCentre),
        directionToCentre: bearingToCardinal(calculateBearing(location.latitude, location.longitude, geofence.latitude, geofence.longitude))
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
