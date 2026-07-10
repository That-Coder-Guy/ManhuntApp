/**
 * Device-orientation math for the compass.
 *
 * Terminology: a *compass heading* is degrees clockwise from north (0 = north,
 * 90 = east). DeviceOrientation `alpha` is degrees COUNTERclockwise, so it is
 * not a heading by itself — it must be converted, and tilt must be accounted
 * for. These are pure functions so they can be unit tested.
 */

const DEG = Math.PI / 180;

// Below this |cos(beta)| the device is close to vertical: the top of the
// device points near the zenith and its horizontal projection is meaningless.
const VERTICAL_COSINE_LIMIT = 0.2;

/**
 * Tilt-compensated compass heading of the top of the device, from an
 * *absolute* deviceorientation event's Euler angles (degrees).
 *
 * Projects the device y-axis (through the top edge of the screen) onto the
 * horizontal plane. The y-axis is unaffected by gamma (rotation about y), so
 * only alpha and beta matter:
 *   east  = -sin(alpha)·cos(beta)
 *   north =  cos(alpha)·cos(beta)
 *   heading = atan2(east, north)
 *
 * Returns degrees in [0, 360), or null when the reading is unusable (missing
 * alpha, or device near-vertical where the projection degenerates — callers
 * should hold the last good heading).
 */
export function headingFromEuler(alpha, beta)
{
    if (alpha == null) return null;

    const a = alpha * DEG;
    const b = (beta ?? 0) * DEG;

    const cosB = Math.cos(b);
    if (Math.abs(cosB) < VERTICAL_COSINE_LIMIT) return null;

    const east = -Math.sin(a) * cosB;
    const north = Math.cos(a) * cosB;

    const heading = Math.atan2(east, north) / DEG;
    return (heading + 360) % 360;
}

/**
 * Compensate a device-frame heading for browser screen rotation so the arrow
 * is drawn relative to the top of the *screen*, not the top of the device.
 * screenAngle is `screen.orientation.angle` (0 | 90 | 180 | 270).
 */
export function applyScreenRotation(heading, screenAngle)
{
    if (heading == null) return null;
    return ((heading + (screenAngle || 0)) % 360 + 360) % 360;
}

/**
 * Circular exponential smoothing between two headings (degrees). Averages on
 * the unit circle so 359° → 1° moves through 0°, not through 180°.
 * factor ∈ (0, 1]: 1 = no smoothing (take next), small = heavy smoothing.
 * Returns degrees in [0, 360).
 */
export function smoothHeading(previous, next, factor = 0.3)
{
    if (next == null) return previous;
    if (previous == null) return ((next % 360) + 360) % 360;

    const p = previous * DEG;
    const n = next * DEG;

    const x = (1 - factor) * Math.cos(p) + factor * Math.cos(n);
    const y = (1 - factor) * Math.sin(p) + factor * Math.sin(n);

    // Opposite headings cancel out; just take the new value
    if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) {
        return ((next % 360) + 360) % 360;
    }

    const smoothed = Math.atan2(y, x) / DEG;
    return (smoothed + 360) % 360;
}

/**
 * Compass point ("N", "NE", ...) for a bearing in degrees — used by the
 * no-compass fallback to describe the direction in words.
 */
export function bearingToCardinal(bearing)
{
    if (bearing == null) return null;
    const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
    return points[index];
}
