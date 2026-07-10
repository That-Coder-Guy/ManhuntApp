/**
 * Format an epoch-milliseconds timestamp as a short "time ago" string
 */
export function getTimeAgo(epochTimestamp)
{
    if (!epochTimestamp) return 'N/A';

    const secondsAgo = Math.floor((Date.now() - epochTimestamp) / 1000);

    // Future timestamps (clock sync issues) read as fresh
    if (secondsAgo < 5) return 'Just now';
    if (secondsAgo < 60) return `${secondsAgo}s ago`;
    if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
    return `${Math.floor(secondsAgo / 3600)}h ago`;
}

/**
 * True when a location timestamp is older than the given threshold (default 30s)
 */
export function isStale(epochTimestamp, thresholdMs = 30_000)
{
    if (!epochTimestamp) return true;
    return Date.now() - epochTimestamp > thresholdMs;
}
