import { useState, useEffect } from 'react';
import PlayerNameEditor from './PlayerNameEditor';
import RoleSwitcher from './RoleSwitcher';
import SeekerView from './SeekerView';
import HiderView from './HiderView';
import LobbyHeader from './LobbyHeader';
import PlayerTableModal from './PlayerTableModal';
import { tradePlayerData, API_RESPONSE_STATUS } from '../utils/api.js';

function LobbyFound({ lobbyConnection, initialPlayerData, onError, onClearSession, onUpdatePlayerData, permissionsGranted = false })
{
    // Destructure lobby connection data
    const { lobbyId, lobbyName, playerToken } = lobbyConnection;
    
    // Player data with local state for name and role updates
    const [playerName, setPlayerName] = useState(initialPlayerData?.name || '');
    const [isSeeker, setIsSeeker] = useState(initialPlayerData?.is_seeker || false);
    const { player_id } = initialPlayerData || {};

    // Update session data when player data changes
    const updatePlayerData = (updates) => {
        if (onUpdatePlayerData) {
            onUpdatePlayerData(updates);
        }
    };

    // State for current location
    const [currentLocation, setCurrentLocation] = useState({
        latitude: null,
        longitude: null
    });

    // State for other players in the lobby
    const [otherPlayers, setOtherPlayers] = useState([]);

    // State for modal
    const [isPlayerTableModalOpen, setIsPlayerTableModalOpen] = useState(false);

    // Trade player data with server
    async function tradePlayerDataWithServer()
    {
        if (!lobbyId || !playerToken) return;
        
        try
        {
            // Use the centralized API function with optional location data
            const data = await tradePlayerData(
                lobbyId, 
                playerToken, 
                currentLocation.latitude, 
                currentLocation.longitude
            );
            
            // Filter out current player as an extra safety measure
            const filteredPlayers = data.other_players.filter(player => player.player_id !== player_id);
            setOtherPlayers(filteredPlayers);
        }
        catch (error)
        {
            // Handle specific API error statuses
            if (error.status === API_RESPONSE_STATUS.LOBBY_NOT_FOUND || 
                error.status === API_RESPONSE_STATUS.INVALID_PLAYER_TOKEN ||
                error.status === API_RESPONSE_STATUS.HTTP_ERROR ||
                error.status === API_RESPONSE_STATUS.NETWORK_ERROR) {
                onError(error.status);
                return;
            }
            
            // Don't call onError for network errors, just log them
            // This prevents kicking users out due to temporary network issues
        }
    }

    // Get current geolocation
    function updateLocation(position)
    {
        setCurrentLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
        });
    }

    function getLocation()
    {
        if (navigator.geolocation)
        {
            navigator.geolocation.getCurrentPosition(updateLocation);
        }
    }

    // Effect to get location periodically once permissions granted
    useEffect(() =>
    {
        if (!permissionsGranted) {
            return undefined;
        }

        getLocation();
        const intervalId = setInterval(getLocation, 2000);
        return () => clearInterval(intervalId);
    }, [permissionsGranted]);

    // Effect to trade player data when lobby connection is available
    useEffect(() =>
    {
        if (lobbyId && playerToken)
        {
            tradePlayerDataWithServer();
            const intervalId = setInterval(tradePlayerDataWithServer, 2000);
            return () => clearInterval(intervalId);
        }
    }, [lobbyId, playerToken, currentLocation]);

    return (
        <div className="lobby-container">
            <LobbyHeader
                lobbyId={lobbyId}
                lobbyName={lobbyName}
                playerToken={playerToken}
                onClearSession={onClearSession}
                onOpenPlayerTable={() => setIsPlayerTableModalOpen(true)}
            />
                
            <div className="player-controls lobby-card-base">
                <PlayerNameEditor
                    currentName={playerName}
                    playerId={player_id}
                    lobbyId={lobbyId}
                    playerToken={playerToken}
                    onNameUpdate={(newName) => {
                        setPlayerName(newName);
                        updatePlayerData({ name: newName });
                    }}
                    onError={onError}
                />

                <RoleSwitcher
                    isSeeker={isSeeker}
                    playerId={player_id}
                    lobbyId={lobbyId}
                    playerToken={playerToken}
                    onRoleUpdate={(newRole) => {
                        setIsSeeker(newRole);
                        updatePlayerData({ is_seeker: newRole });
                    }}
                    onError={onError}
                />

                <div className="role-view-container">
                    {isSeeker ? (
                        <SeekerView 
                            players={otherPlayers}
                            currentLocation={currentLocation}
                        />
                    ) : (
                        <HiderView 
                            players={otherPlayers}
                            currentLocation={currentLocation}
                        />
                    )}
                </div>
            </div>

            {/* Player Table Modal */}
            <PlayerTableModal
                players={otherPlayers}
                currentPlayer={{
                    player_id: player_id,
                    name: playerName,
                    is_seeker: isSeeker,
                    location_last_updated: Date.now() // Current time since we just updated location
                }}
                isOpen={isPlayerTableModalOpen}
                onClose={() => setIsPlayerTableModalOpen(false)}
            />
        </div>
    );
}

export default LobbyFound;
