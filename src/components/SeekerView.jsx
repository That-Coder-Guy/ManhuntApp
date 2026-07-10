import { useState, useEffect } from 'react';
import CompassArrow from './CompassArrow';
import { calculateDistance, formatDistance } from '../utils/geo';
import { getTimeAgo, isStale } from '../utils/time';

function SeekerView({ players, currentLocation })
{
    // Filter to get only hiders
    const hiders = players.filter(player => !player.is_seeker);

    // State for view mode: 'list' or 'compass'
    const [viewMode, setViewMode] = useState('list');

    // State for selected hider
    const [selectedHider, setSelectedHider] = useState(null);

    // State for content visibility during transitions
    const [contentVisible, setContentVisible] = useState(true);

    // Tick every second so "updated Xs ago" labels stay current
    const [, setTick] = useState(0);
    useEffect(() =>
    {
        const intervalId = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(intervalId);
    }, []);

    // Handle hiders list changes - update selected hider or reset to list view
    useEffect(() => {
        if (hiders.length === 0) {
            setSelectedHider(null);
            setViewMode('list');
        } else if (selectedHider) {
            // Check if selected hider still exists in the list
            const updatedHider = hiders.find(h => h.player_id === selectedHider.player_id);
            if (!updatedHider) {
                // Selected hider is gone, reset to list view
                setSelectedHider(null);
                setViewMode('list');
            } else {
                // Update selected hider with latest data (including name changes)
                setSelectedHider(updatedHider);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hiders]);

    // Handle player selection - switch to compass view with morph animation
    function handlePlayerSelect(hider) {
        setSelectedHider(hider);
        // Start fade out
        setContentVisible(false);
        // After fade out, start morphing
        setTimeout(() => {
            setViewMode('compass');
            // After morph completes, show compass content
            setTimeout(() => {
                setContentVisible(true);
            }, 250); // Match morph duration (0.25s)
        }, 100); // Match fade out duration (0.1s)
    }

    // Handle compass click - switch back to list view with reverse animation
    function handleCompassClick() {
        // Start fade out
        setContentVisible(false);
        // After fade out, start morphing back and switch view
        setTimeout(() => {
            setViewMode('list');
            setSelectedHider(null);
            // After morph completes, show list content
            setTimeout(() => {
                setContentVisible(true);
            }, 250); // Match morph duration (0.25s)
        }, 100); // Match fade out duration (0.1s)
    }

    // Get selected hider distance
    const selectedDistance = selectedHider
        ? calculateDistance(
            currentLocation.latitude,
            currentLocation.longitude,
            selectedHider.latitude,
            selectedHider.longitude
        )
        : null;

    return (
        <div className={`seeker-view-wrapper ${viewMode === 'compass' ? 'compass-mode' : ''}`}>
            <div className="seeker-view">
            {hiders.length === 0 ? (
                <div className="no-targets">
                    No hiders
                </div>
            ) : viewMode === 'compass' && selectedHider ? (
                /* Compass View - shows only the compass */
                <div className={`seeker-compass-view ${contentVisible ? 'content-visible' : 'content-hidden'}`}>
                    <div
                        className="compass-container-morph"
                        onClick={handleCompassClick}
                    >
                        <CompassArrow
                            targetLatitude={selectedHider.latitude}
                            targetLongitude={selectedHider.longitude}
                            currentLocation={currentLocation}
                            targetName={selectedHider.name || `Player ${selectedHider.player_id}`}
                            distance={selectedDistance}
                            locationLastUpdated={selectedHider.location_last_updated}
                            isDisconnected={selectedHider.connected === false}
                            onClick={handleCompassClick}
                        />
                    </div>
                </div>
            ) : (
                /* List View - shows scrollable list of players */
                <div className={`seeker-list-view ${contentVisible ? 'content-visible' : 'content-hidden'}`}>
                    <h3 className="targets-title">
                        Select Target ({hiders.length} hiders)
                    </h3>
                    <div className="targets-list">
                        {hiders.map((hider) => {
                            const distance = calculateDistance(
                                currentLocation.latitude,
                                currentLocation.longitude,
                                hider.latitude,
                                hider.longitude
                            );
                            const stale = isStale(hider.location_last_updated) || hider.connected === false;

                            return (
                                <div
                                    key={hider.player_id}
                                    onClick={() => handlePlayerSelect(hider)}
                                    className={`target-card ${stale ? 'player-stale' : ''}`}
                                >
                                    <div className="target-info">
                                        <strong className="target-name">{hider.name || `Player ${hider.player_id}`}</strong>
                                        <span className="player-freshness">
                                            {hider.connected === false ? 'offline · ' : ''}
                                            {hider.location_last_updated
                                                ? `updated ${getTimeAgo(hider.location_last_updated)}`
                                                : 'no location yet'}
                                        </span>
                                    </div>
                                    <div className="distance-badge target-distance">
                                        {formatDistance(distance)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            </div>
        </div>
    );
}

export default SeekerView;
