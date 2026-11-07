import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import LobbyFound from '../components/LobbyFound';
import LobbyLoading from '../components/LobbyLoading';
import LobbyError from '../components/LobbyError';
import PlayerError from '../components/PlayerError';
import PermissionsGate from '../components/PermissionsGate';
import useWakeLock from '../hooks/useWakeLock';
import useLobbySocket, { JOIN_STATE } from '../hooks/useLobbySocket';
import { loadPlayerToken, savePlayerToken, clearPlayerToken } from '../utils/session';

function LobbySession({ lobbyId })
{
    // Read once per lobby (the route keys this component by lobby ID)
    const [initialToken] = useState(() => loadPlayerToken(lobbyId));
    const [permissionsGranted, setPermissionsGranted] = useState(false);

    const saveSession = useCallback((joined) => savePlayerToken(lobbyId, joined.player_token), [lobbyId]);
    const clearSession = useCallback(() =>
    {
        clearPlayerToken(lobbyId);
        setPermissionsGranted(false);
    }, [lobbyId]);

    const lobby = useLobbySocket(lobbyId, initialToken, saveSession);
    const { joinState } = lobby;
    const wakeLock = useWakeLock(joinState === JOIN_STATE.JOINED);

    useEffect(() =>
    {
        // A dead token can't be resumed: forget it so the next visit joins fresh
        if (joinState === JOIN_STATE.PLAYER_TIMED_OUT) clearPlayerToken(lobbyId);
        if (joinState !== JOIN_STATE.JOINED) setPermissionsGranted(false);
    }, [joinState, lobbyId]);

    switch (joinState)
    {
        case JOIN_STATE.CONNECTING:
            return <LobbyLoading />;

        case JOIN_STATE.JOINED:
            return (
                <>
                    <LobbyFound
                        lobbyId={lobbyId}
                        lobbyName={lobby.lobbyName}
                        selfPlayer={lobby.selfPlayer}
                        players={lobby.players}
                        connectionState={lobby.connectionState}
                        lastSyncTime={lobby.lastSyncTime}
                        lastLocationSentAt={lobby.lastLocationSentAt}
                        updateLocation={lobby.updateLocation}
                        updatePlayer={lobby.updatePlayer}
                        leaveLobby={lobby.leaveLobby}
                        onClearSession={clearSession}
                        permissionsGranted={permissionsGranted}
                    />
                    <PermissionsGate
                        isOpen={!permissionsGranted}
                        onComplete={() => setPermissionsGranted(true)}
                        requestWakeLock={wakeLock.requestWakeLock}
                        isWakeLockSupported={wakeLock.isSupported}
                        isWakeLockActive={wakeLock.isActive}
                    />
                </>
            );

        case JOIN_STATE.PLAYER_TIMED_OUT:
            return <PlayerError lobbyId={lobbyId} />;

        default:
            return <LobbyError />;
    }
}

function Lobby()
{
    const { lobby_id: lobbyId } = useParams();
    // Keyed so moving between lobbies remounts with that lobby's own token
    return <LobbySession key={lobbyId} lobbyId={lobbyId} />;
}

export default Lobby;
