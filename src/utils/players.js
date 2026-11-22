import { getTimeAgo, isStale, STALE_AFTER_MS } from './time.js';

/** Display name, falling back to the server's player number */
export const playerName = (player) => player.name || `Player ${player.player_id}`;

/**
 * Everything the UI shows about how current a player's position is:
 * whether it is fresh, whether they're offline or jamming, and the meta line.
 * A hider who is jamming (`jammed_until`, from the server) is never fresh:
 * the position is the one from when the jam started.
 */
export function playerFreshness(player, now = Date.now())
{
    const offline = player.connected === false;
    const jammed = Boolean(player.jammed_until);
    const stale = offline || jammed || isStale(player.location_last_updated, STALE_AFTER_MS, now);
    const seen = player.location_last_updated ? getTimeAgo(player.location_last_updated, now) : null;
    const updated = seen ? `updated ${seen}` : 'no location yet';

    let label = updated;
    if (offline) label = `Offline · ${updated}`;
    else if (jammed) label = seen ? `Jammed · last seen ${seen}` : 'Jammed';
    return { offline, jammed, fresh: !stale, label };
}
