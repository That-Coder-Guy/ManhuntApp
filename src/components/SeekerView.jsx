import { useState, useEffect } from 'react';
import CompassArrow from './CompassArrow';

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

    // Get selected hider distance
    const selectedDistance = selectedHider && currentLocation.latitude && currentLocation.longitude
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
                            const distance = currentLocation.latitude && currentLocation.longitude && hider.latitude && hider.longitude
                                ? calculateDistance(
                                    currentLocation.latitude,
                                    currentLocation.longitude,
                                    hider.latitude,
                                    hider.longitude
                                )
                                : null;

                            return (
                                <div
                                    key={hider.player_id}
                                    onClick={() => handlePlayerSelect(hider)}
                                    className="target-card"
                                >
                                    <div className="target-info">
                                        <strong className="target-name">{hider.name || `Player ${hider.player_id}`}</strong>
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

