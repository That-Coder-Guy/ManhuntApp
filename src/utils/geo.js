/**
 * Calculate distance in meters between two coordinates (Haversine formula).
 * Returns null when any coordinate is missing (0 is a valid coordinate).
 */
export function calculateDistance(lat1, lon1, lat2, lon2)
{
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;

    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

/**
 * Calculate initial bearing in degrees (0-360) from one coordinate to another.
 * Returns null when any coordinate is missing.
 */
export function calculateBearing(lat1, lon1, lat2, lon2)
{
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;

    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    bearing = (bearing + 360) % 360; // Normalize to 0-360

    return bearing;
}

/**
 * Format a distance in meters for display
 */
export function formatDistance(distance)
{
    if (distance == null) return 'Unknown';
    if (distance < 1000) return `${Math.round(distance)}m`;
    return `${(distance / 1000).toFixed(2)}km`;
}
