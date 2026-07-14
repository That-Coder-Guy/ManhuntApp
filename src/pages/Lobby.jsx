import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import LobbyFound from '../components/LobbyFound';
import LobbyLoading from '../components/LobbyLoading';
import LobbyError from '../components/LobbyError';
import PlayerError from '../components/PlayerError';
import PermissionsGate from '../components/PermissionsGate';
import useWakeLock from '../hooks/useWakeLock';
import useLobbySocket, { JOIN_STATE } from '../hooks/useLobbySocket';

// Sessions older than this are discarded
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 1 day
const MAX_SESSIONS = 10;

// Clean up all expired sessions from localStorage
function cleanupExpiredSessions()
{
    try {
        const now = Date.now();
        const sessions = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('manhunt_lobby_')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    sessions.push({
                        key,
                        timestamp: data.timestamp || 0,
                        age: now - (data.timestamp || 0)
                    });
                } catch {
                    // Corrupted session, remove it
                    localStorage.removeItem(key);
                }
            }
        }

        // Remove expired sessions
        sessions.forEach(session => {
            if (session.age > SESSION_TIMEOUT) {
                localStorage.removeItem(session.key);
            }
        });

        // If still too many sessions, keep only the most recent ones
        const remainingSessions = sessions.filter(s => s.age <= SESSION_TIMEOUT);
        if (remainingSessions.length > MAX_SESSIONS) {
            remainingSessions
                .sort((a, b) => a.timestamp - b.timestamp) // Oldest first
                .slice(0, remainingSessions.length - MAX_SESSIONS)
                .forEach(session => localStorage.removeItem(session.key));
        }
    } catch (error) {
        console.error('Error cleaning up expired sessions:', error);
    }
}

function Lobby()
{
    const { lobby_id: lobbyId } = useParams();
    const STORAGE_KEY = `manhunt_lobby_${lobbyId}`;

    const [permissionsGranted, setPermissionsGranted] = useState(false);

    // Load the saved player token once, before the socket connects
    const savedTokenRef = useRef(undefined);
    if (savedTokenRef.current === undefined)
    {
        cleanupExpiredSessions();
        let token = null;
        try {
            const sessionData = localStorage.getItem(STORAGE_KEY);
            if (sessionData) {
                const parsed = JSON.parse(sessionData);
                if (Date.now() - parsed.timestamp <= SESSION_TIMEOUT) {
                    token = parsed.playerToken || null;
                } else {
                    localStorage.removeItem(STORAGE_KEY);
                }
            }
        } catch (error) {
            console.error('Error loading session:', error);
            localStorage.removeItem(STORAGE_KEY);
        }
        savedTokenRef.current = token;
    }

    const saveSession = useCallback((joinedData) =>
    {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                playerToken: joinedData.player_token,
                timestamp: Date.now()
            }));
        } catch (error) {
            console.error('Error saving session:', error);
        }
    }, [STORAGE_KEY]);

    const clearSession = useCallback(() =>
    {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            console.error('Error clearing session:', error);
        }
        setPermissionsGranted(false);
    }, [STORAGE_KEY]);

    const {
        joinState,
        lobbyName,
        selfPlayer,
        players,
        connectionState,
        lastSyncTime,
        lastLocationSentAt,
        updateLocation,
        updatePlayer,
        leaveLobby
    } = useLobbySocket(lobbyId, savedTokenRef.current, saveSession);

    const { isSupported: isWakeLockSupported, isActive: isWakeLockActive, requestWakeLock } = useWakeLock(
        joinState === JOIN_STATE.JOINED
    );

    // A dead token can't be resumed — drop it so the next visit joins fresh
    useEffect(() =>
    {
        if (joinState === JOIN_STATE.PLAYER_TIMED_OUT) {
            clearSession();
        }
        if (joinState !== JOIN_STATE.JOINED) {
            setPermissionsGranted(false);
        }
    }, [joinState, clearSession]);

    switch (joinState)
    {
        case JOIN_STATE.CONNECTING:
            return <LobbyLoading />;

        case JOIN_STATE.JOINED:
            return (
                <>
                    <LobbyFound
                        lobbyId={lobbyId}
                        lobbyName={lobbyName}
                        selfPlayer={selfPlayer}
                        players={players}
                        connectionState={connectionState}
                        lastSyncTime={lastSyncTime}
                        lastLocationSentAt={lastLocationSentAt}
                        updateLocation={updateLocation}
                        updatePlayer={updatePlayer}
                        leaveLobby={leaveLobby}
                        onClearSession={clearSession}
                        permissionsGranted={permissionsGranted}
                    />
                    <PermissionsGate
                        isOpen={!permissionsGranted}
                        onComplete={() => setPermissionsGranted(true)}
                        requestWakeLock={requestWakeLock}
                        isWakeLockSupported={isWakeLockSupported}
                        isWakeLockActive={isWakeLockActive}
                    />

                </>
            );

        case JOIN_STATE.PLAYER_TIMED_OUT:
            return <PlayerError lobbyId={lobbyId} />;

        case JOIN_STATE.LOBBY_NOT_FOUND:
        case JOIN_STATE.ERROR:
        default:
            return <LobbyError />;
    }
}

export default Lobby;
