// Pure game rules: session settings, play-area checks and avatar checks.
// No I/O here, so everything is unit-testable. The polygon geometry is the
// same module the app uses (shared/geofence.js), so both agree on "inside".

const { polygonProblem, pointInPolygon } = require('../shared/geofence.js');

const PHASE = Object.freeze({
    LOBBY: 'lobby',     // pregame: players join, set profiles, host sets rules
    PLAYING: 'playing',
    ENDED: 'ended',
});

const LIMITS = Object.freeze({
    timeLimitMaxS: 3 * 60 * 60,
    headStartMaxS: 10 * 60,
    foundRangeMinM: 10,   // tighter than phone GPS can tell apart
    foundRangeMaxM: 500,
    seekerAlertMinM: 10,
    seekerAlertMaxM: 1000,
    // A seeker's position older than this can't count toward a find: they
    // may have moved anywhere since
    foundFixMaxAgeMs: 2 * 60 * 1000,
    avatarMaxChars: 40_000, // ~30 KB image; a 96px JPEG is a few KB
});

const DEFAULT_SETTINGS = Object.freeze({
    geofence: null,       // { points: [{ latitude, longitude }, ...] } or null for no play area
    time_limit_s: 0,      // 0 = no limit
    head_start_s: 0,      // seekers wait this long after the start
    found_range_m: 50,    // a hider may declare themselves found this close to a seeker
    // What hiders learn about the seekers during a game:
    //   'distance' — how far away the nearest seeker is
    //   'nearby'   — only whether a seeker is within seeker_alert_m
    //   'none'     — nothing
    seeker_info: 'distance',
    seeker_alert_m: 100,
});

const SEEKER_INFO_MODES = ['distance', 'nearby', 'none'];

const isWholeInRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/**
 * Merge a partial settings update into the current settings and validate the
 * result. Returns { settings } or { error }.
 */
function applySettings(current, update)
{
    if (!update || typeof update !== 'object' || Array.isArray(update)) return { error: 'Settings must be an object' };

    const next = { ...current };

    if ('geofence' in update)
    {
        const fence = update.geofence;
        if (fence === null)
        {
            next.geofence = null;
        }
        else
        {
            const points = fence && typeof fence === 'object' ? fence.points : undefined;
            const problem = polygonProblem(points);
            if (problem) return { error: problem };
            // Keep only the coordinates, whatever else the client sent
            next.geofence = { points: points.map(({ latitude, longitude }) => ({ latitude, longitude })) };
        }
    }

    if ('time_limit_s' in update)
    {
        if (!isWholeInRange(update.time_limit_s, 0, LIMITS.timeLimitMaxS)) return { error: 'Time limit is invalid' };
        next.time_limit_s = update.time_limit_s;
    }

    if ('head_start_s' in update)
    {
        if (!isWholeInRange(update.head_start_s, 0, LIMITS.headStartMaxS)) return { error: 'Head start is invalid' };
        next.head_start_s = update.head_start_s;
    }

    if ('found_range_m' in update)
    {
        if (!isWholeInRange(update.found_range_m, LIMITS.foundRangeMinM, LIMITS.foundRangeMaxM)) return { error: 'Found range is invalid' };
        next.found_range_m = update.found_range_m;
    }

    if ('seeker_info' in update)
    {
        if (!SEEKER_INFO_MODES.includes(update.seeker_info)) return { error: 'Seeker info setting is invalid' };
        next.seeker_info = update.seeker_info;
    }

    if ('seeker_alert_m' in update)
    {
        if (!isWholeInRange(update.seeker_alert_m, LIMITS.seekerAlertMinM, LIMITS.seekerAlertMaxM)) return { error: 'Alert distance is invalid' };
        next.seeker_alert_m = update.seeker_alert_m;
    }

    return { settings: next };
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two { latitude, longitude } */
function distanceMeters(a, b)
{
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const hasPosition = (p) => p.latitude != null && p.longitude != null;

/**
 * The closest seeker to a hider, counting only seekers with a recent fix:
 * { seeker, distance } or null when no seeker has one.
 */
function nearestSeeker(hider, players, now)
{
    if (!hasPosition(hider)) return null;
    let best = null;
    for (const p of players)
    {
        if (!p.is_seeker || !hasPosition(p)) continue;
        if (!(now - p.location_last_updated <= LIMITS.foundFixMaxAgeMs)) continue;
        const distance = distanceMeters(hider, p);
        if (!best || distance < best.distance) best = { seeker: p, distance };
    }
    return best;
}

/**
 * What one hider is told about the seekers, as the lobby's seeker_info
 * setting allows. Worked out here so seekers' positions never leave the
 * server for a hider's phone:
 *   { mode: 'distance', distance_m }   metres to the nearest seeker, or null
 *   { mode: 'nearby', alert_m, nearby } true / false, or null without a fix
 *   { mode: 'none' }
 * Counts only seekers with a recent fix, as finding does.
 */
function seekerInfoFor(settings, hider, players, now)
{
    const mode = settings.seeker_info ?? DEFAULT_SETTINGS.seeker_info;
    if (mode === 'none') return { mode };
    const nearest = hasPosition(hider) ? nearestSeeker(hider, players, now) : null;
    if (mode === 'nearby')
    {
        const alertM = settings.seeker_alert_m ?? DEFAULT_SETTINGS.seeker_alert_m;
        return { mode, alert_m: alertM, nearby: hasPosition(hider) ? Boolean(nearest && nearest.distance <= alertM) : null };
    }
    return { mode: 'distance', distance_m: nearest ? Math.round(nearest.distance) : null };
}

/** True when a player with a known position is outside the play area */
function isOutOfBounds(geofence, player)
{
    if (!geofence || player.latitude == null || player.longitude == null) return false;
    return !pointInPolygon(player, geofence.points);
}

/** A small profile picture as a base64 data URL, or null to clear it */
function isValidAvatar(avatar)
{
    if (avatar === null) return true;
    return typeof avatar === 'string'
        && avatar.length <= LIMITS.avatarMaxChars
        && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar);
}

module.exports = {
    PHASE, LIMITS, DEFAULT_SETTINGS, SEEKER_INFO_MODES, applySettings, isOutOfBounds, isValidAvatar, distanceMeters,
    nearestSeeker, seekerInfoFor
};
