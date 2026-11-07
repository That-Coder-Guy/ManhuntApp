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
    avatarMaxChars: 40_000, // ~30 KB image; a 96px JPEG is a few KB
});

const DEFAULT_SETTINGS = Object.freeze({
    geofence: null,       // { points: [{ latitude, longitude }, ...] } or null for no play area
    time_limit_s: 0,      // 0 = no limit
    head_start_s: 0,      // seekers wait this long after the start
});

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

    return { settings: next };
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

module.exports = { PHASE, LIMITS, DEFAULT_SETTINGS, applySettings, isOutOfBounds, isValidAvatar };
