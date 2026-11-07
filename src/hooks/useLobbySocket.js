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

// Give up on the *initial* join after this many failed attempts.
// After a successful join, reconnection retries forever.
const MAX_INITIAL_CONNECT_ATTEMPTS = 5;

// At most one location upload per interval; newer fixes replace queued ones
const LOCATION_SEND_INTERVAL_MS = 2000;

const ACK_TIMEOUT_MS = 8000;
const LEAVE_TIMEOUT_MS = 3000;

function networkError(message)
{
    const error = new Error(message);
    error.status = 'network_error';
    return error;
}

/**
 * Emit and wait for the server's acknowledgement. Rejects with
 * status 'network_error' when offline or timed out, or with the server's
 * status when it answers with anything but success.
 */
async function emitWithAck(socket, event, payload, timeoutMs = ACK_TIMEOUT_MS)
{
    if (!socket?.connected) throw networkError('Not connected');

    let response;
    try {
        response = await socket.timeout(timeoutMs).emitWithAck(event, payload);
    } catch {
        throw networkError('Request timed out');
    }

    if (response?.status !== 'success')
    {
        const error = new Error(response?.description || 'Request failed');
        error.status = response?.status || 'error';
        throw error;
    }
    return response;
}

/**
 * The Socket.IO connection for one lobby: join or resume with a player token,
 * receive pushed lobby state, and send location and player updates.
 * Transient disconnects are handled here with automatic reconnection; only
 * fatal outcomes (lobby gone, token expired, can't connect at all) surface
 * through joinState.
 */
function useLobbySocket(lobbyId, initialToken, onJoined)
{
    const socketRef = useRef(null);
    const onJoinedRef = useRef(onJoined);
    onJoinedRef.current = onJoined;

    const [joinState, setJoinState] = useState(JOIN_STATE.CONNECTING);
    const [lobbyName, setLobbyName] = useState(null);
    const [selfPlayer, setSelfPlayer] = useState(null);
    const [players, setPlayers] = useState([]);
    const [connectionState, setConnectionState] = useState(CONNECTION_STATE.RECONNECTING);
    const [lastSyncTime, setLastSyncTime] = useState(null);
    const [lastLocationSentAt, setLastLocationSentAt] = useState(null);

    // Location upload: the newest fix, when one was last sent, and a pending send
    const latestLocationRef = useRef(null);
    const lastSendAttemptRef = useRef(0);
    const sendTimerRef = useRef(null);

    const sendLatestLocation = useCallback(() =>
    {
        const socket = socketRef.current;
        const location = latestLocationRef.current;
        // While disconnected, nothing is queued: the newest fix is re-sent on rejoin
        if (!socket?.connected || !location) return;

        lastSendAttemptRef.current = Date.now();
        emitWithAck(socket, 'update-location', location)
            .then(() => setLastLocationSentAt(Date.now()))
            .catch(() => { /* the next fix or rejoin retries */ });
    }, []);

    useEffect(() =>
    {
        if (!lobbyId) return undefined;

        // Per-connection state: a new lobby or token starts from scratch
        let hasJoined = false;
        let stopped = false; // gave up, or the server ended this session
        let failedAttempts = 0;
        let selfId = null;
        setJoinState(JOIN_STATE.CONNECTING);
        setPlayers([]);

        // Empty API_ORIGIN means this server also serves the frontend
        const socket = io(API_ORIGIN || window.location.origin, {
            path: SOCKET_PATH,
            auth: { lobby_id: lobbyId, player_token: initialToken || undefined },
            reconnectionDelayMax: 10000,
            timeout: 10000
        });
        socketRef.current = socket;
        window.__manhuntSocket = socket; // debug handle for field testing and e2e

        socket.on('connect', () => setConnectionState(CONNECTION_STATE.CONNECTED));
        socket.on('disconnect', () => setConnectionState(CONNECTION_STATE.RECONNECTING));

        socket.on('connect_error', () =>
        {
            setConnectionState(CONNECTION_STATE.RECONNECTING);
            // Before the first join there is nothing to resume, so stop
            // retrying and say so rather than spin forever
            if (!hasJoined && ++failedAttempts >= MAX_INITIAL_CONNECT_ATTEMPTS)
            {
                stopped = true;
                setJoinState(JOIN_STATE.ERROR);
                socket.disconnect();
            }
        });

        // Sent on every (re)connection
        socket.on('joined', (data) =>
        {
            // Reconnections must resume this identity, not create a new player
            socket.auth.player_token = data.player_token;
            hasJoined = true;
            selfId = data.player_data?.player_id ?? null;

            setLobbyName(data.lobby_name);
            setSelfPlayer(data.player_data);
            setJoinState(JOIN_STATE.JOINED);
            setLastSyncTime(Date.now());
            onJoinedRef.current?.(data);

            // A stationary phone may not report a new GPS fix for a long time;
            // re-send the last one so the server isn't left with a stale position
            sendLatestLocation();
        });

        socket.on('lobby-state', (data) =>
        {
            const all = Array.isArray(data?.players) ? data.players : [];
            const self = all.find((p) => p.player_id === selfId);
            if (self) setSelfPlayer(self);
            setPlayers(all.filter((p) => p.player_id !== selfId));
            setLastSyncTime(Date.now());
        });

        socket.on('fatal-error', (data) =>
        {
            const fatal = {
                lobby_not_found: JOIN_STATE.LOBBY_NOT_FOUND,
                invalid_player_token: JOIN_STATE.PLAYER_TIMED_OUT
            };
            stopped = true;
            setJoinState(fatal[data?.status] ?? JOIN_STATE.ERROR);
            socket.disconnect();
        });

        // Reconnect as soon as the browser is back online, not after the backoff
        const handleOnline = () => { if (!socket.connected && !stopped) socket.connect(); };
        window.addEventListener('online', handleOnline);

        return () =>
        {
            window.removeEventListener('online', handleOnline);
            clearTimeout(sendTimerRef.current);
            sendTimerRef.current = null;
            socket.disconnect();
            socketRef.current = null;
            if (window.__manhuntSocket === socket) delete window.__manhuntSocket;
        };
    }, [lobbyId, initialToken, sendLatestLocation]);

    const updateLocation = useCallback((latitude, longitude) =>
    {
        latestLocationRef.current = { latitude, longitude };
        if (sendTimerRef.current) return; // a send is already scheduled and will pick this up

        const wait = Math.max(0, LOCATION_SEND_INTERVAL_MS - (Date.now() - lastSendAttemptRef.current));
        sendTimerRef.current = setTimeout(() =>
        {
            sendTimerRef.current = null;
            sendLatestLocation();
        }, wait);
    }, [sendLatestLocation]);

    const updatePlayer = useCallback(async (updates) =>
    {
        const response = await emitWithAck(socketRef.current, 'update-player', updates);
        setSelfPlayer(response.player_data);
        return response;
    }, []);

    // Best effort: leaving must work offline too, so it never rejects
    const leaveLobby = useCallback(async () =>
    {
        const socket = socketRef.current;
        try {
            await emitWithAck(socket, 'leave-lobby', {}, LEAVE_TIMEOUT_MS);
        } catch {
            // Offline or no answer: the server expires the player after its grace period
        } finally {
            socket?.disconnect();
        }
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
