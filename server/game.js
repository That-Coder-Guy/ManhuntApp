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
    // A picture in the chat: shrunk and compressed on the phone before it's sent
    chatImageMaxBytes: 72_000,
    chatImageMaxSide: 4096,
    chatImagesKept: 40,      // pictures a lobby keeps; older ones are dropped, their messages stay
    // No more than this many pictures from one player in this long
    chatImageBurst: 4,
    chatImageBurstMs: 30_000,
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
    // radius halves as their speed doubles, and faster than an 11-minute mile the
    // position is exact. 0 = always exact.
    hider_blur_m: 25,
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

    // Where the alert is all a hider is told of the seekers, it never
    // reaches further than the found range: whichever of the two the host
    // changed, the alert distance is brought down to fit. (In the other
    // modes it isn't used, and is left as it was.)
    if (next.seeker_info === 'nearby') next.seeker_alert_m = Math.min(next.seeker_alert_m, next.found_range_m);

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
        // (never further than the found range: applySettings sees to that, and so does this)
        const alertM = Math.min(settings.seeker_alert_m ?? DEFAULT_SETTINGS.seeker_alert_m, settings.found_range_m ?? DEFAULT_SETTINGS.found_range_m);
        return { mode, alert_m: alertM, nearby: hasPosition(hider) ? Boolean(nearest && nearest.distance <= alertM) : null };
    }
    return { mode: 'distance', distance_m: nearest ? Math.round(nearest.distance) : null };
}

const MILE_M = 1609.344;

// ---- How exactly seekers see a hider: the slower, the vaguer ----
//
// The radius is inversely related to the hider's speed: the lobby's full
// radius standing still, half of it at a stroll, a quarter at a walk, and
// the exact position for anyone going faster than an 11-minute mile (a
// jog). It moves in those steps, not smoothly, and what seekers get is the centre of a circle that
// stays where it is, not a point near the hider, because anything that
// shifted with the hider's true position could be averaged or extrapolated
// back to it:
//   - the circle is put down at random around the hider, so they may be
//     anywhere in it, and while they stay in it its centre is all seekers
//     ever see;
//   - when the step changes, the new circle lies inside the old one (or
//     round it), and a circle shown before is shown again if the hider is
//     still in it, so going back and forth between steps tells no more
//     than the smallest circle already shown;
//   - only walking out of a circle gets a new one.
const BLUR = Object.freeze({
    // Speed is the net distance covered over each of these, and the lower of
    // the two counts: sustained movement to become exact, a short stop to
    // become vague again. GPS wobble on the spot covers almost no net distance
    windows_ms: [15_000, 5_000],
    // An 11-minute mile, in metres a second (2.44): the owner's line. Anyone
    // going faster is shown exactly
    exact_mps: MILE_M / (11 * 60),
    // That pace is judged over this alone, so a hider who breaks into a run
    // is exact within seconds, not after the longer window above. Nothing
    // standing still reads as a run: wobble can pass for a stroll over a
    // few seconds (which is why the smaller steps wait), never for this
    exact_window_ms: 6_000,
    // [at or above this speed, share of the lobby's radius], fastest first:
    // the radius halves each time the speed doubles (1.22 and 0.61 m/s)
    steps: [[MILE_M / (11 * 60) / 2, 1 / 4], [MILE_M / (11 * 60) / 4, 1 / 2], [0, 1]],
    // Reaching a threshold counts at once. Going back needs the speed to
    // fall this far under it, so a speed hovering at one doesn't flip the
    // circle back and forth
    hysteresis: 0.15,
    // A new circle is put down so the hider starts at least this share of
    // the radius inside it: standing where it was put down, a little GPS
    // wobble doesn't carry them straight out of it again
    margin: 0.15,
});
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
function hiderSpeed(fixes, now, windows = BLUR.windows_ms)
{
    const latest = fixes[fixes.length - 1];
    if (!latest) return 0;
    let slowest = Infinity;
    for (const windowMs of windows)
    {
        const before = positionAt(fixes, now - windowMs);
        if (!before) return 0;
        // Over the time since that fix, not the window's length: fixes come
        // every couple of seconds, and the one found may be older than the
        // window is long
        slowest = Math.min(slowest, distanceMeters(before, latest) / ((now - before.at) / 1000));
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
 * more exact step as soon as the speed reaches the threshold (faster than an
 * 11-minute mile is exact, without a margin on top), and back to a vaguer
 * one only once the speed is clearly under it. `quick` is the speed over
 * the last few seconds alone (BLUR.exact_window_ms): at the exact pace it
 * is enough by itself, and keeps a hider exact while they hold it.
 */
function nextBlurShare(previous, speed, quick = speed)
{
    if (quick >= BLUR.exact_mps) return 0;
    if (previous === 0 && quick * (1 + BLUR.hysteresis) >= BLUR.exact_mps) return 0;
    const reached = blurShareAt(speed);
    if (previous == null || reached < previous) return reached;
    const ifFaster = blurShareAt(speed * (1 + BLUR.hysteresis));
    return ifFaster > previous ? ifFaster : previous;
}

const METRES_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_M;

// A point `east` and `north` metres from another
function offsetBy(point, east, north)
{
    return {
        latitude: point.latitude + north / METRES_PER_DEGREE,
        longitude: point.longitude + east / (METRES_PER_DEGREE * Math.cos(toRad(point.latitude))),
    };
}

/**
 * The circle a hider is shown in: { latitude, longitude, radius }, its
 * centre and how far from it they may be. `shown` is the circle shown last
 * (null: none). `random` gives numbers in [0, 1), like Math.random.
 *
 * While the hider is inside a circle of this radius, it stays. Otherwise a
 * new one is put down at random around them: evenly, so that they are as
 * likely to be in one part of it as another, anywhere up to its edge less
 * the margin. If the radius has changed and they are still inside the old
 * circle, the new one lies wholly inside it (smaller) or holds all of it
 * (larger), so seekers learn nothing from laying one over the other. The
 * hider is always within `radiusM` of the centre returned.
 */
function blurredPosition(position, radiusM, shown = null, random = Math.random)
{
    const inside = shown ? distanceMeters(position, shown) <= shown.radius : false;
    if (inside && shown.radius === radiusM) return shown;

    const reach = radiusM / (1 + BLUR.margin);
    // How far the new centre may be from the old for one circle to lie inside the other
    const leeway = inside ? Math.abs(shown.radius - radiusM) : Infinity;
    for (let attempt = 0; attempt < 60; attempt++)
    {
        // Evenly over the disc: the square root spreads points by area
        const distance = reach * Math.sqrt(random());
        const bearing = 2 * Math.PI * random();
        const centre = offsetBy(position, Math.sin(bearing) * distance, Math.cos(bearing) * distance);
        if (leeway === Infinity || distanceMeters(centre, shown) <= leeway) return { ...centre, radius: radiusM };
    }
    // No room found at random (the hider is at the old circle's very edge).
    // Larger: centred where the old one was. Smaller: as near the hider as
    // staying inside the old one allows, which still holds them
    if (radiusM > shown.radius) return { latitude: shown.latitude, longitude: shown.longitude, radius: radiusM };
    const out = distanceMeters(position, shown);
    const along = out > 0 ? Math.min(1, leeway / out) : 0;
    return {
        latitude: shown.latitude + (position.latitude - shown.latitude) * along,
        longitude: shown.longitude + (position.longitude - shown.longitude) * along,
        radius: radiusM,
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

// The chats a lobby has: one for everyone, and one for each side
const CHAT_CHANNELS = Object.freeze(['all', 'seekers', 'hiders']);

/** The side's chat a player is in: 'seekers' or 'hiders' */
const chatSide = (player) => (player.is_seeker ? 'seekers' : 'hiders');

/** The chat a message is meant for: 'all' when none is named, null if it names one that doesn't exist */
function cleanChatChannel(channel)
{
    if (channel === undefined || channel === null) return 'all';
    return CHAT_CHANNELS.includes(channel) ? channel : null;
}

/**
 * Whether a player is given a chat message. Everyone gets what's said to
 * everyone. What's said to one side goes to who is on that side, and only
 * what was said since they came onto it: `side_from` is the number the next
 * message had at that moment (numbers, not times: two things in the same
 * millisecond still have an order). Changing sides, or joining late, never
 * hands over what a side said before. So a seeker can't
 * read the hiders' plans by turning hider for a moment in the lobby, and a
 * hider who is caught joins the seekers with none of their talk either.
 */
function seesChatMessage(message, player)
{
    const channel = message.channel ?? 'all';
    if (channel === 'all') return true;
    return channel === chatSide(player) && message.id >= (player.side_from ?? 0);
}

/** What kind of picture these bytes are, by how they begin: only the two the app sends */
function chatImageType(bytes)
{
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

/**
 * A picture for the chat, as sent: { data: bytes, width, height }. Returns
 * { bytes, type, width, height }, or null if it isn't one this server keeps:
 * a JPEG or WebP no bigger than the limit. The type is read from the bytes,
 * never taken from the sender; the size is only used to lay the message out.
 */
function cleanChatImage(image)
{
    if (!image || typeof image !== 'object') return null;
    const { data, width, height } = image;
    if (!(data instanceof Uint8Array) || data.length === 0 || data.length > LIMITS.chatImageMaxBytes) return null;
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const type = chatImageType(bytes);
    const isSide = (value) => Number.isInteger(value) && value >= 1 && value <= LIMITS.chatImageMaxSide;
    if (!type || !isSide(width) || !isSide(height)) return null;
    return { bytes, type, width, height };
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
    BLUR, FIX_HISTORY_MS, hiderSpeed, nextBlurShare, blurredPosition, cleanChatText, cleanChatImage,
    CHAT_CHANNELS, chatSide, cleanChatChannel, seesChatMessage
};
