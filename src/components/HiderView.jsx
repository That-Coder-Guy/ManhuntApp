import { useEffect, useState } from 'react';
import { calculateDistance, formatDistance } from '../utils/geo';
import { getTimeAgo, isStale } from '../utils/time';

function HiderView({ players, currentLocation })
{
    // Filter to get only seekers
    const seekers = players.filter(player => player.is_seeker);

    // Tick every second so "updated Xs ago" labels stay current
    const [, setTick] = useState(0);
    useEffect(() =>
    {
        const intervalId = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(intervalId);
    }, []);

    // Find closest seeker
    function getClosestSeeker()
    {
        let closest = null;
        let minDistance = Infinity;
        seekers.forEach(seeker => {
            const distance = calculateDistance(
                currentLocation.latitude,
                currentLocation.longitude,
                seeker.latitude,
                seeker.longitude
            );
            if (distance !== null && distance < minDistance) {
                minDistance = distance;
                closest = seeker;
            }
        });

        return closest ? { seeker: closest, distance: minDistance } : null;
    }

    const closest = getClosestSeeker();
    const closestDistance = closest ? closest.distance : null;
    const closestStale = closest
        ? (isStale(closest.seeker.location_last_updated) || closest.seeker.connected === false)
        : false;

    return (
        <div className="hider-view-wrapper">
            <div className="hider-view">
            {seekers.length === 0 ? (
                <div className="no-seekers">
                    No seekers
                </div>
            ) : (
                <>
                    <div className="closest-seeker">
                        <div className="closest-label">
                            Closest Seeker
                        </div>
                        <div className={`closest-distance ${closestDistance && closestDistance < 100 ? 'danger' : 'safe'}`}>
                            {formatDistance(closestDistance)}
                        </div>
                        {closest && closestStale && (
                            <div className="closest-freshness">
                                updated {getTimeAgo(closest.seeker.location_last_updated)}
                            </div>
                        )}
                    </div>

                    <h3 className="seekers-title">
                        Active Seekers: {seekers.length}
                    </h3>
                    <div className="seekers-list">
                        {seekers.map((seeker) => {
                            const distance = calculateDistance(
                                currentLocation.latitude,
                                currentLocation.longitude,
                                seeker.latitude,
                                seeker.longitude
                            );
                            const stale = isStale(seeker.location_last_updated) || seeker.connected === false;

                            return (
                                <div
                                    key={seeker.player_id}
                                    className={`seeker-card ${stale ? 'player-stale' : ''}`}
                                >
                                    <div className="seeker-info">
                                        <strong className="seeker-name">{seeker.name || `Player ${seeker.player_id}`}</strong>
                                        <span className="player-freshness">
                                            {seeker.connected === false ? 'offline · ' : ''}
                                            {seeker.location_last_updated
                                                ? `updated ${getTimeAgo(seeker.location_last_updated)}`
                                                : 'no location yet'}
                                        </span>
                                    </div>
                                    <div className={`distance-badge seeker-distance ${distance && distance < 100 ? 'danger' : 'safe'}`}>
                                        {formatDistance(distance)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
            </div>
        </div>
    );
}

export default HiderView;
