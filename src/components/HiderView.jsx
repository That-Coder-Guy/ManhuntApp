import useNow from '../hooks/useNow';
import { calculateDistance } from '../utils/geo';
import { PlayerListCard, PlayerRow } from './PlayerList';

// A seeker inside this range is flagged as close
const DANGER_DISTANCE_M = 100;
// The proximity bar is empty at this distance and full at zero
const PROXIMITY_RANGE_M = 1000;

const proximityFill = (distance) =>
    distance === null ? 0 : Math.min(1, Math.max(0.03, 1 - distance / PROXIMITY_RANGE_M));

const TEST_IDS = {
    card: 'seekers-card', title: 'seekers-title', list: 'seekers-list', empty: 'no-seekers',
    row: 'seeker-card', distance: 'seeker-distance'
};

function HiderView({ players, avatars = {}, currentLocation })
{
    const now = useNow();

    // Closest first; seekers without a location go last
    const seekers = players
        .filter((player) => player.is_seeker)
        .map((seeker) => ({
            seeker,
            distance: calculateDistance(currentLocation.latitude, currentLocation.longitude, seeker.latitude, seeker.longitude)
        }))
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

    return (
        <PlayerListCard title="Seekers" count={seekers.length} emptyText="No seekers in this lobby yet" testIds={TEST_IDS}>
            {seekers.map(({ seeker, distance }) => (
                <PlayerRow
                    key={seeker.player_id}
                    player={seeker}
                    avatar={avatars[seeker.player_id]}
                    distance={distance}
                    now={now}
                    danger={distance !== null && distance < DANGER_DISTANCE_M}
                    proximity={proximityFill(distance)}
                    testIds={TEST_IDS}
                />
            ))}
        </PlayerListCard>
    );
}

export default HiderView;
