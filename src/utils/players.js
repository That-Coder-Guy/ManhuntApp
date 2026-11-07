import { getTimeAgo, isStale, STALE_AFTER_MS } from './time.js';

/** Display name, falling back to the server's player number */
export const playerName = (player) => player.name || `Player ${player.player_id}`;

/**
 * Everything the UI shows about how current a player's position is:
 * whether it is fresh, whether they're offline, and the meta line.
 */
export function playerFreshness(player, now = Date.now())
{
    const offline = player.connected === false;
    const stale = offline || isStale(player.location_last_updated, STALE_AFTER_MS, now);
    const updated = player.location_last_updated
        ? `updated ${getTimeAgo(player.location_last_updated, now)}`
        : 'no location yet';

    return { offline, fresh: !stale, label: offline ? `Offline · ${updated}` : updated };
}
