import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_ORIGIN, SOCKET_PATH } from '../utils/api.js';

// High-level join state of the lobby connection
export const JOIN_STATE = {
    CONNECTING: 'connecting',
    JOINED: 'joined',
    LOBBY_NOT_FOUND: 'lobby_not_found',
    PLAYER_TIMED_OUT: 'invalid_player_token',
    ERROR: 'error'
};

// Live transport state once joined
export const CONNECTION_STATE = {
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting'
};

// Give up on the *initial* join after this many failed connection attempts.
// Reconnections after a successful join retry forever.
const MAX_INITIAL_CONNECT_ATTEMPTS = 5;

// Send at most one location update per interval; extra fixes coalesce into a trailing send
const LOCATION_SEND_INTERVAL_MS = 2000;

const ACTION_ACK_TIMEOUT_MS = 8000;

/**
 * Manages the Socket.IO connection for a lobby: joining/resuming with a player
 * token, receiving pushed lobby state, and sending location/player updates.
 * Transient disconnects are handled internally with automatic reconnection —
 * only fatal statuses (lobby gone, token expired) surface through joinState.
 */
function useLobbySocket(lobbyId, initialToken, onJoined)
{
    const socketRef = useRef(null);
    const selfIdRef = useRef(null);
    const hasJoinedRef = useRef(false);
    const onJoinedRef = useRef(onJoined);
    onJoinedRef.current = onJoined;

    const [joinState, setJoinState] = useState(JOIN_STATE.CONNECTING);
    const [lobbyName, setLobbyName] = useState(null);
    const [selfPlayer, setSelfPlayer] = useState(null);
    const [players, setPlayers] = useState([]);
    const [connectionState, setConnectionState] = useState(CONNECTION_STATE.RECONNECTING);
    const [lastSyncTime, setLastSyncTime] = useState(null);
    const [lastLocationSentAt, setLastLocationSentAt] = useState(null);

    // Location send throttling
    const lastLocationAttemptRef = useRef(0);
    const pendingLocationRef = useRef(null);
    const trailingTimerRef = useRef(null);

    useEffect(() =>
    {
        if (!lobbyId) return undefined;

        let failedAttempts = 0;

        // Empty API_ORIGIN means the server also serves this frontend (same origin)
        const socket = io(API_ORIGIN || window.location.origin, {
            path: SOCKET_PATH,
            auth: {
                lobby_id: lobbyId,
                player_token: initialToken || undefined
            },
            reconnection: true,
            reconnectionDelayMax: 10000,
            timeout: 10000
        });
        socketRef.current = socket;
        // Debug handle for field debugging and tests
        window.__manhuntSocket = socket;

        socket.on('connect', () =>
        {
            setConnectionState(CONNECTION_STATE.CONNECTED);
        });

        socket.on('disconnect', () =>
        {
            setConnectionState(CONNECTION_STATE.RECONNECTING);
        });

        socket.on('connect_error', () =>
        {
            setConnectionState(CONNECTION_STATE.RECONNECTING);

            // Before the first successful join there is nothing to resume, so
            // surface persistent failures instead of spinning forever.
            if (!hasJoinedRef.current)
            {
                failedAttempts += 1;
                if (failedAttempts >= MAX_INITIAL_CONNECT_ATTEMPTS)
                {
                    setJoinState(JOIN_STATE.ERROR);
                    socket.disconnect();
                }
            }
        });

        socket.on('joined', (data) =>
        {
            // Reconnections must resume this identity, not create a new player
            socket.auth.player_token = data.player_token;
            hasJoinedRef.current = true;
            selfIdRef.current = data.player_data?.player_id ?? null;

            setLobbyName(data.lobby_name);
            setSelfPlayer(data.player_data);
            setJoinState(JOIN_STATE.JOINED);
            setLastSyncTime(Date.now());

            if (onJoinedRef.current)
            {
                onJoinedRef.current(data);
            }
        });

        socket.on('lobby-state', (data) =>
        {
            const allPlayers = data?.players || [];
            setPlayers(allPlayers.filter(player => player.player_id !== selfIdRef.current));
            setLastSyncTime(Date.now());
        });

        socket.on('fatal-error', (data) =>
        {
            const status = data?.status;
            if (status === 'lobby_not_found')
            {
                setJoinState(JOIN_STATE.LOBBY_NOT_FOUND);
            }
            else if (status === 'invalid_player_token')
            {
                setJoinState(JOIN_STATE.PLAYER_TIMED_OUT);
            }
            else
            {
                setJoinState(JOIN_STATE.ERROR);
            }
            socket.disconnect();
        });

        // Reconnect immediately when the browser regains connectivity instead
        // of waiting out the current backoff delay
        const handleOnline = () =>
        {
            if (!socket.connected)
            {
                socket.connect();
            }
        };
        window.addEventListener('online', handleOnline);

        return () =>
        {
            window.removeEventListener('online', handleOnline);
            if (trailingTimerRef.current)
            {
                clearTimeout(trailingTimerRef.current);
                trailingTimerRef.current = null;
            }
            socket.disconnect();
            socketRef.current = null;
        };
    }, [lobbyId, initialToken]);

    const sendLocation = useCallback((location) =>
    {
        const socket = socketRef.current;
        // Drop stale fixes while disconnected — only the latest position matters
        if (!socket || !socket.connected) return;

        lastLocationAttemptRef.current = Date.now();
        socket.emit('update-location', location, (response) =>
        {
            if (response?.status === 'success')
            {
                setLastLocationSentAt(Date.now());
            }
        });
    }, []);

    const updateLocation = useCallback((latitude, longitude) =>
    {
        const location = { latitude, longitude };
        const elapsed = Date.now() - lastLocationAttemptRef.current;

        if (elapsed >= LOCATION_SEND_INTERVAL_MS)
        {
            sendLocation(location);
            return;
        }

        pendingLocationRef.current = location;
        if (!trailingTimerRef.current)
        {
            trailingTimerRef.current = setTimeout(() =>
            {
                trailingTimerRef.current = null;
                if (pendingLocationRef.current)
                {
                    sendLocation(pendingLocationRef.current);
                    pendingLocationRef.current = null;
                }
            }, LOCATION_SEND_INTERVAL_MS - elapsed);
        }
    }, [sendLocation]);

    const updatePlayer = useCallback((updates) =>
    {
        return new Promise((resolve, reject) =>
        {
            const socket = socketRef.current;
            if (!socket || !socket.connected)
            {
                const error = new Error('Not connected');
                error.status = 'network_error';
                reject(error);
                return;
            }

            socket.timeout(ACTION_ACK_TIMEOUT_MS).emit('update-player', updates, (timeoutError, response) =>
            {
                if (timeoutError)
                {
                    const error = new Error('Request timed out');
                    error.status = 'network_error';
                    reject(error);
                    return;
                }
                if (response?.status !== 'success')
                {
                    const error = new Error(response?.description || 'Update failed');
                    error.status = response?.status || 'error';
                    reject(error);
                    return;
                }
                setSelfPlayer(response.player_data);
                resolve(response);
            });
        });
    }, []);

    const leaveLobby = useCallback(() =>
    {
        return new Promise((resolve) =>
        {
            const socket = socketRef.current;
            if (!socket || !socket.connected)
            {
                if (socket) socket.disconnect();
                resolve();
                return;
            }

            socket.timeout(3000).emit('leave-lobby', {}, () =>
            {
                socket.disconnect();
                resolve();
            });
        });
    }, []);

    return {
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
    };
}

export default useLobbySocket;
