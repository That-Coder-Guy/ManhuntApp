function HiderView({ players, currentLocation })
{
    // Filter to get only seekers
    const seekers = players.filter(player => player.is_seeker);

    // Calculate distance between two coordinates (Haversine formula)
    function calculateDistance(lat1, lon1, lat2, lon2)
    {
        if (!lat1 || !lon1 || !lat2 || !lon2) return null;
        
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        const distance = R * c; // Distance in meters
        return distance;
    }

    // Format distance for display
    function formatDistance(distance)
    {
        if (distance === null) return 'Unknown';
        if (distance < 1000) return `${Math.round(distance)}m`;
        return `${(distance / 1000).toFixed(2)}km`;
    }

    // Find closest seeker
    function getClosestSeekerDistance()
    {
        if (seekers.length === 0 || !currentLocation.latitude || !currentLocation.longitude) return null;

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
            }
        });

        return minDistance === Infinity ? null : minDistance;
    }

    const closestDistance = getClosestSeekerDistance();

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
                    </div>

                    <h3 className="seekers-title">
                        Active Seekers: {seekers.length}
                    </h3>
                    <div className="seekers-list">
                        {seekers.map((seeker) => {
                            const distance = currentLocation.latitude && currentLocation.longitude && seeker.latitude && seeker.longitude
                                ? calculateDistance(
                                    currentLocation.latitude,
                                    currentLocation.longitude,
                                    seeker.latitude,
                                    seeker.longitude
                                )
                                : null;

                            return (
                                <div
                                    key={seeker.player_id}
                                    className="seeker-card"
                                >
                                    <div className="seeker-info">
                                        <strong className="seeker-name">{seeker.name || `Player ${seeker.player_id}`}</strong>
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

