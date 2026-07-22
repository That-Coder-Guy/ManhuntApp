/**
 * Extra players for local UI testing (list scrolling, distances, freshness).
 * Only merged in when import.meta.env.DEV is true.
 */

const now = () => Date.now();

function makePlayer(index, isSeeker)
{
    const role = isSeeker ? 'Seeker' : 'Hider';
    // Spread around a fixed downtown point so distances vary
    const latitude = 30.2672 + (index % 5) * 0.004 - 0.008;
    const longitude = -97.7431 + Math.floor(index / 5) * 0.004 - 0.008;

    return {
        player_id: `dummy-${role.toLowerCase()}-${index}`,
        name: `Dummy ${role} ${index}`,
        is_seeker: isSeeker,
        latitude,
        longitude,
        location_last_updated: now() - (index * 4_000),
        connected: index % 4 !== 0
    };
}

export const DUMMY_PLAYERS = [
    ...Array.from({ length: 12 }, (_, i) => makePlayer(i + 1, false)),
    ...Array.from({ length: 12 }, (_, i) => makePlayer(i + 1, true))
];

export function withDummyPlayers(players)
{
    if (!import.meta.env.DEV) return players;
    return [...players, ...DUMMY_PLAYERS];
}
