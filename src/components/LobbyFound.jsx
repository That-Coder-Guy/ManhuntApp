import { useState, useEffect, useRef } from 'react';
import PlayerNameEditor from './PlayerNameEditor';
import RoleSwitcher from './RoleSwitcher';
import SeekerView from './SeekerView';
import HiderView from './HiderView';
import LobbyHeader from './LobbyHeader';
import PlayerTableModal from './PlayerTableModal';
import ConnectionBanner from './ConnectionBanner';

function LobbyFound({
    lobbyId,
    lobbyName,
    selfPlayer,
    players,
    connectionState,
    lastSyncTime,
    lastLocationSentAt,
    updateLocation,
    updatePlayer,
    leaveLobby,
    onClearSession,
    permissionsGranted = false
})
{
    const { player_id, name: playerName, is_seeker: isSeeker } = selfPlayer || {};

    // Current GPS position (kept locally so own distances work even offline)
    const [currentLocation, setCurrentLocation] = useState({
        latitude: null,
        longitude: null
    });
    const [gpsError, setGpsError] = useState(false);

    // State for modal
    const [isPlayerTableModalOpen, setIsPlayerTableModalOpen] = useState(false);

    // Keep the latest updateLocation without retriggering the geolocation watch
    const updateLocationRef = useRef(updateLocation);
    updateLocationRef.current = updateLocation;

    // Continuously watch the device position once permissions are granted.
    // GPS often works when the network doesn't: local state always updates,
    // while uploads are throttled/dropped by the socket hook as needed.
    useEffect(() =>
    {
        if (!permissionsGranted) return undefined;

        if (!navigator.geolocation)
        {
            setGpsError(true);
            return undefined;
        }

        const watchId = navigator.geolocation.watchPosition(
            (position) =>
            {
                setGpsError(false);
                const { latitude, longitude } = position.coords;
                setCurrentLocation({ latitude, longitude });
                updateLocationRef.current(latitude, longitude);
            },
            (error) =>
            {
                console.warn('Geolocation error:', error);
                setGpsError(true);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 5000,
                timeout: 15000
            }
        );

        return () => navigator.geolocation.clearWatch(watchId);
    }, [permissionsGranted]);

    return (
        <div className="lobby-container">
            <ConnectionBanner
                connectionState={connectionState}
                lastSyncTime={lastSyncTime}
                gpsError={gpsError}
            />

            <LobbyHeader
                lobbyId={lobbyId}
                lobbyName={lobbyName}
                leaveLobby={leaveLobby}
                onClearSession={onClearSession}
                onOpenPlayerTable={() => setIsPlayerTableModalOpen(true)}
            />

            <div className="player-controls lobby-card-base">
                <PlayerNameEditor
                    currentName={playerName}
                    updatePlayer={updatePlayer}
                />

                <RoleSwitcher
                    isSeeker={isSeeker}
                    updatePlayer={updatePlayer}
                />

                <div className="role-view-container">
                    {isSeeker ? (
                        <SeekerView
                            players={players}
                            currentLocation={currentLocation}
                        />
                    ) : (
                        <HiderView
                            players={players}
                            currentLocation={currentLocation}
                        />
                    )}
                </div>
            </div>

            {/* Player Table Modal */}
            <PlayerTableModal
                players={players}
                currentPlayer={{
                    player_id: player_id,
                    name: playerName,
                    is_seeker: isSeeker,
                    connected: true,
                    location_last_updated: lastLocationSentAt
                }}
                isOpen={isPlayerTableModalOpen}
                onClose={() => setIsPlayerTableModalOpen(false)}
            />
        </div>
    );
}

export default LobbyFound;
