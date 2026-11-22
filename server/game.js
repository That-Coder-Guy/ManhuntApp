// Pure game rules: session settings, play-area checks, jamming and avatar checks.
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
    jamDurationMinS: 10,
    jamDurationMaxS: 10 * 60,
    jamChargeMinS: 10,
    jamChargeMaxS: 60 * 60,
    hiderBlurMinM: 20,
    hiderBlurMaxM: 500,
    chatMaxChars: 280,
    chatHistory: 200,        // messages a lobby keeps, for players who join or reconnect
    // No more than this many messages from one player in this long
    chatBurst: 5,
    chatBurstMs: 5000,
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
    // Jamming: a hider can stop the seekers' tracking of them for a while.
    // The seekers keep the position from the moment the jam started
    jam_enabled: true,
    jam_duration_s: 60,       // how long one jam lasts
    jam_charge_s: 15 * 60,    // how long a jam takes to charge: from the seekers' release, and after each jam
    // How exactly seekers see a hider depends on how fast the hider moves. A
    // still hider is only shown as somewhere within this many metres; the
    // radius halves as their speed doubles, and from walking pace up the
    // position is exact. 0 = always exact.
    hider_blur_m: 100,
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

    if ('jam_enabled' in update)
    {
        if (typeof update.jam_enabled !== 'boolean') return { error: 'Jamming setting is invalid' };
        next.jam_enabled = update.jam_enabled;
    }

    if ('jam_duration_s' in update)
    {
        if (!isWholeInRange(update.jam_duration_s, LIMITS.jamDurationMinS, LIMITS.jamDurationMaxS)) return { error: 'Jam length is invalid' };
        next.jam_duration_s = update.jam_duration_s;
    }

    if ('jam_charge_s' in update)
    {
        if (!isWholeInRange(update.jam_charge_s, LIMITS.jamChargeMinS, LIMITS.jamChargeMaxS)) return { error: 'Jam charge time is invalid' };
        next.jam_charge_s = update.jam_charge_s;
    }

    if ('hider_blur_m' in update)
    {
        const blur = update.hider_blur_m;
        if (blur !== 0 && !isWholeInRange(blur, LIMITS.hiderBlurMinM, LIMITS.hiderBlurMaxM)) return { error: 'Hider position setting is invalid' };
        next.hider_blur_m = blur;
    }

    return { settings: next };
}

/**
 * Where a hider's jammer stands. A jam charges from the moment the seekers
 * set off, and again from the end of each jam. `player.jam_until` is when
 * their running jam ends and `player.jam_ready_at` when their next one is
 * charged (unset: they have been a hider since the start).
 *   { enabled: false }
 *   { enabled: true, state: 'charging' | 'ready' | 'active', until, ready_at, duration_s, charge_s }
 * `until` is null unless a jam is running. The phone works the state out
 * again from the times as its clock moves on (src/utils/game.js jamView).
 */
function jamStatus(settings, game, player, now)
{
    if (!(settings.jam_enabled ?? DEFAULT_SETTINGS.jam_enabled) || !game) return { enabled: false };
    const durationS = settings.jam_duration_s ?? DEFAULT_SETTINGS.jam_duration_s;
    const chargeS = settings.jam_charge_s ?? DEFAULT_SETTINGS.jam_charge_s;
    const active = player.jam_until != null && now < player.jam_until;
    const readyAt = player.jam_ready_at ?? game.head_start_ends_at + chargeS * 1000;
    return {
        enabled: true,
        state: active ? 'active' : now < readyAt ? 'charging' : 'ready',
        until: active ? player.jam_until : null,
        ready_at: readyAt,
        duration_s: durationS,
        charge_s: chargeS
    };
}

/** True while this hider's jam is running */
const isJamming = (player, now) => !player.is_seeker && player.jam_until != null && now < player.jam_until;

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

// ---- How exactly seekers see a hider: the slower, the vaguer ----
//
// The radius is inversely related to the hider's speed: the lobby's full
// radius standing still, half of it at 0.3 m/s, a quarter at 0.6 m/s, and
// the exact position from walking pace (1.2 m/s). It moves in those steps,
// not smoothly, and what seekers get is the centre of a fixed square on a
// grid, not a point near the hider, because anything that shifted with the
// hider's true position could be averaged or extrapolated back to it:
//   - while a hider stays in their square, its centre is all seekers ever see;
//   - the grids are nested (each step's squares split the last one's in
//     four), so a change of step never narrows it further than the finest
//     square already shown;
//   - where each hider's grid lies is random, and theirs alone.
const BLUR = Object.freeze({
    // Speed is the net distance covered over each of these, and the lower of
    // the two counts: sustained movement to become exact, a short stop to
    // become vague again. GPS wobble on the spot covers almost no net distance
    windows_ms: [30_000, 10_000],
    exact_mps: 1.2,
    // [at or above this speed, share of the lobby's radius], fastest first
    steps: [[0.6, 1 / 4], [0.3, 1 / 2], [0, 1]],
    // A step only changes once the speed is this far past its threshold, so
    // a speed hovering at one doesn't flip the square back and forth
    hysteresis: 0.15,
    // A hider stays in their square until this far (a share of its side)
    // outside it, so standing on an edge doesn't give the edge away
    margin: 0.15,
});
// The square's side, for a circle of the reported radius to hold the square
// and the margin around it: (side / 2 + margin * side) * sqrt(2) = radius
const BLUR_SIDE_PER_RADIUS = Math.SQRT2 / (1 + 2 * BLUR.margin);
// How long a hider's past positions are kept, to work their speed out
const FIX_HISTORY_MS = Math.max(...BLUR.windows_ms) + 15_000;

/** The last position at or before `time`, from fixes in the order they came; null if there's none */
function positionAt(fixes, time)
{
    let found = null;
    for (const fix of fixes)
    {
        if (fix.at > time) break;
        found = fix;
    }
    return found;
}

/**
 * How fast a hider is going, in metres a second, from their recent fixes
 * ([{ latitude, longitude, at }], oldest first). Someone with no history yet,
 * or who has stopped reporting, counts as standing still.
 */
function hiderSpeed(fixes, now)
{
    const latest = fixes[fixes.length - 1];
    if (!latest) return 0;
    let slowest = Infinity;
    for (const windowMs of BLUR.windows_ms)
    {
        const before = positionAt(fixes, now - windowMs);
        if (!before) return 0;
        slowest = Math.min(slowest, distanceMeters(before, latest) / (windowMs / 1000));
    }
    return slowest;
}

// The share of the lobby's radius that goes with a speed: 0 is exact
function blurShareAt(speed)
{
    if (speed >= BLUR.exact_mps) return 0;
    return BLUR.steps.find(([from]) => speed >= from)[1];
}

/**
 * The share to use now, given the one in use (null: none yet). It moves to a
 * more exact step only once the speed is clearly past the threshold, and to
 * a vaguer one only once it is clearly under.
 */
function nextBlurShare(previous, speed)
{
    if (previous == null) return blurShareAt(speed);
    const ifSlower = blurShareAt(speed * (1 - BLUR.hysteresis));
    const ifFaster = blurShareAt(speed * (1 + BLUR.hysteresis));
    if (ifSlower < previous) return ifSlower;
    if (ifFaster > previous) return ifFaster;
    return previous;
}

const METRES_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_M;

/**
 * The centre of the grid square a position falls in, for a reported radius.
 * `origin` ({ latitude, longitude }) fixes where the grid lies; `previous`
 * is the square reported last time ({ side, column, row }), kept while the
 * position is within the margin of it. Returns { latitude, longitude, cell }:
 * the position is always within `radiusM` of the centre.
 */
function blurredPosition(position, radiusM, origin, previous = null)
{
    const side = radiusM * BLUR_SIDE_PER_RADIUS;
    const metresPerDegreeLon = METRES_PER_DEGREE * Math.cos(toRad(origin.latitude));
    const x = (position.longitude - origin.longitude) * metresPerDegreeLon;
    const y = (position.latitude - origin.latitude) * METRES_PER_DEGREE;

    let column = Math.floor(x / side);
    let row = Math.floor(y / side);
    if (previous && previous.side === side)
    {
        const slack = BLUR.margin * side;
        const inside = (value, index) => value >= index * side - slack && value < (index + 1) * side + slack;
        if (inside(x, previous.column) && inside(y, previous.row)) ({ column, row } = previous);
    }
    return {
        latitude: origin.latitude + ((row + 0.5) * side) / METRES_PER_DEGREE,
        longitude: origin.longitude + ((column + 0.5) * side) / metresPerDegreeLon,
        cell: { side, column, row }
    };
}

/** True when a player with a known position is outside the play area */
function isOutOfBounds(geofence, player)
{
    if (!geofence || player.latitude == null || player.longitude == null) return false;
    return !pointInPolygon(player, geofence.points);
}

/**
 * A chat message as it will be kept: one line, trimmed, with anything that
 * isn't printable (control characters, stray line breaks) turned into a
 * space. Null if that leaves nothing, or it is too long or isn't text.
 */
function cleanChatText(text)
{
    if (typeof text !== 'string') return null;
    // eslint-disable-next-line no-control-regex
    const clean = text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean || [...clean].length > LIMITS.chatMaxChars) return null;
    return clean;
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
    nearestSeeker, seekerInfoFor, jamStatus, isJamming,
    BLUR, FIX_HISTORY_MS, hiderSpeed, nextBlurShare, blurredPosition, cleanChatText
};
