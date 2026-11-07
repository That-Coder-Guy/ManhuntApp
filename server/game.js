// Pure game rules: session settings, play-area math and avatar checks.
// No I/O here, so everything is unit-testable.

const PHASE = Object.freeze({
    LOBBY: 'lobby',     // pregame: players join, set profiles, host sets rules
    PLAYING: 'playing',
    ENDED: 'ended',
});

const LIMITS = Object.freeze({
    radiusMinM: 50,
    radiusMaxM: 5000,
    timeLimitMaxS: 3 * 60 * 60,
    headStartMaxS: 10 * 60,
    avatarMaxChars: 40_000, // ~30 KB image; a 96px JPEG is a few KB
});

const DEFAULT_SETTINGS = Object.freeze({
    geofence: null,       // { latitude, longitude, radius_m } or null for no play area
    time_limit_s: 0,      // 0 = no limit
    head_start_s: 0,      // seekers wait this long after the start
});

const isCoordinate = (value, limit) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
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
            if (!fence || typeof fence !== 'object') return { error: 'Play area is invalid' };
            const { latitude, longitude, radius_m: radius } = fence;
            if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) return { error: 'Play area centre is invalid' };
            if (!isWholeInRange(radius, LIMITS.radiusMinM, LIMITS.radiusMaxM))
            {
                return { error: `Play area radius must be ${LIMITS.radiusMinM}–${LIMITS.radiusMaxM} m` };
            }
            next.geofence = { latitude, longitude, radius_m: radius };
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

    return { settings: next };
}

/** Great-circle distance in metres (haversine) */
function distanceMeters(lat1, lon1, lat2, lon2)
{
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** True when a player with a known position is outside the play area */
function isOutOfBounds(geofence, player)
{
    if (!geofence || player.latitude == null || player.longitude == null) return false;
    return distanceMeters(geofence.latitude, geofence.longitude, player.latitude, player.longitude) > geofence.radius_m;
}

/** A small profile picture as a base64 data URL, or null to clear it */
function isValidAvatar(avatar)
{
    if (avatar === null) return true;
    return typeof avatar === 'string'
        && avatar.length <= LIMITS.avatarMaxChars
        && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar);
}

module.exports = { PHASE, LIMITS, DEFAULT_SETTINGS, applySettings, distanceMeters, isOutOfBounds, isValidAvatar };
