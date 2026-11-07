// A position older than this is shown as stale
export const STALE_AFTER_MS = 30_000;

/**
 * Short relative time for an epoch-ms timestamp: "just now", "12s ago",
 * "4m ago", "2h ago", or "—" when there is none.
 */
export function getTimeAgo(epochTimestamp, now = Date.now())
{
    if (!epochTimestamp) return '—';

    const secondsAgo = Math.floor((now - epochTimestamp) / 1000);
    // Future timestamps (clock skew between devices) read as fresh
    if (secondsAgo < 5) return 'just now';
    if (secondsAgo < 60) return `${secondsAgo}s ago`;
    if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
    return `${Math.floor(secondsAgo / 3600)}h ago`;
}

/** True when a location timestamp is missing or older than the threshold */
export function isStale(epochTimestamp, thresholdMs = STALE_AFTER_MS, now = Date.now())
{
    return !epochTimestamp || now - epochTimestamp > thresholdMs;
}
