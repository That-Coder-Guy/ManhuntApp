import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getApiOrigin, SOCKET_PATH } from '../utils/api.js';

// High-level join state of the lobby connection
export const JOIN_STATE = {
    CONNECTING: 'connecting',
    JOINED: 'joined',
    LOBBY_NOT_FOUND: 'lobby_not_found',
    PLAYER_TIMED_OUT: 'invalid_player_token',
    KICKED: 'kicked',
    ERROR: 'error'
};

// Live transport state once joined
export const CONNECTION_STATE = {
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting'
};

// Session phase, decided by the server
export const PHASE = {
    LOBBY: 'lobby',
    PLAYING: 'playing',
    ENDED: 'ended'
};

// Give up on the *initial* join after this many failed attempts.
// After a successful join, reconnection retries forever.
const MAX_INITIAL_CONNECT_ATTEMPTS = 5;

// At most one location upload per interval; newer fixes replace queued ones
const LOCATION_SEND_INTERVAL_MS = 2000;

const ACK_TIMEOUT_MS = 8000;
const LEAVE_TIMEOUT_MS = 3000;

const FATAL_STATES = {
    lobby_not_found: JOIN_STATE.LOBBY_NOT_FOUND,
    invalid_player_token: JOIN_STATE.PLAYER_TIMED_OUT,
    kicked: JOIN_STATE.KICKED
};

function networkError(message)
{
    const error = new Error(message);
    error.status = 'network_error';
    return error;
}

/**
 * Emit and wait for the server's acknowledgement. Rejects with
 * status 'network_error' when offline or timed out, or with the server's
 * status (and its description as the message) for anything but success.
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

const EMPTY_LOBBY = { phase: PHASE.LOBBY, hostId: null, settings: null, game: null, players: [] };

/**
 * The Socket.IO connection for one lobby: join or resume with a player token
 * (and the host key, for the creator), receive pushed lobby state and
 * pictures, and send updates. Transient disconnects are handled here with
 * automatic reconnection; only fatal outcomes (lobby gone, token expired,
 * removed by the host, can't connect at all) surface through joinState.
 */
function useLobbySocket(lobbyId, credentials, onJoined)
{
    const { playerToken: initialToken, hostKey } = credentials || {};
    const socketRef = useRef(null);
    const onJoinedRef = useRef(onJoined);
    onJoinedRef.current = onJoined;

    const [joinState, setJoinState] = useState(JOIN_STATE.CONNECTING);
    const [lobbyName, setLobbyName] = useState(null);
    const [selfId, setSelfId] = useState(null);
    const [lobby, setLobby] = useState(EMPTY_LOBBY);
    const [avatars, setAvatars] = useState({});
    // Server clock minus ours, so countdowns agree across phones
    const [clockOffset, setClockOffset] = useState(0);
    const [connectionState, setConnectionState] = useState(CONNECTION_STATE.RECONNECTING);
    const [lastSyncTime, setLastSyncTime] = useState(null);

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
        emitWithAck(socket, 'update-location', location).catch(() => { /* the next fix or rejoin retries */ });
    }, []);

    useEffect(() =>
    {
        if (!lobbyId) return undefined;

        // Per-connection state: a new lobby or token starts from scratch
        let hasJoined = false;
        let stopped = false; // gave up, or the server ended this session
        let failedAttempts = 0;
        setJoinState(JOIN_STATE.CONNECTING);
        setLobby(EMPTY_LOBBY);
        setAvatars({});

        const applyState = (state) =>
        {
            if (!state) return;
            setLobby({
                phase: state.phase,
                hostId: state.host_id,
                settings: state.settings,
                game: state.game,
                players: Array.isArray(state.players) ? state.players : []
            });
            if (Number.isFinite(state.server_time)) setClockOffset(state.server_time - Date.now());
            setLastSyncTime(Date.now());
        };

        let socket = null;
        let cancelled = false;

        const connect = (origin) =>
        {
            socket = io(origin, {
                path: SOCKET_PATH,
                auth: { lobby_id: lobbyId, player_token: initialToken || undefined, host_key: hostKey || undefined },
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

                setLobbyName(data.lobby_name);
                setSelfId(data.player_id);
                applyState(data.state);
                setJoinState(JOIN_STATE.JOINED);
                onJoinedRef.current?.(data);

                // A stationary phone may not report a new GPS fix for a long time;
                // re-send the last one so the server isn't left with a stale position
                sendLatestLocation();
            });

            socket.on('lobby-state', applyState);

            // Pictures arrive apart from the per-second state: all on join, then each change
            socket.on('avatars', (data) => setAvatars(data?.avatars && typeof data.avatars === 'object' ? data.avatars : {}));
            socket.on('avatar', ({ player_id: playerId, avatar } = {}) =>
                setAvatars((current) => ({ ...current, [playerId]: avatar || undefined })));

            socket.on('fatal-error', (data) =>
            {
                stopped = true;
                setJoinState(FATAL_STATES[data?.status] ?? JOIN_STATE.ERROR);
                socket.disconnect();
            });
        };

        // Where the server is may need looking up first (a frontend on Vercel)
        getApiOrigin().then(
            (origin) => { if (!cancelled) connect(origin); },
            () => { if (!cancelled) setJoinState(JOIN_STATE.ERROR); });

        // Reconnect as soon as the browser is back online, not after the backoff
        const handleOnline = () => { if (socket && !socket.connected && !stopped) socket.connect(); };
        window.addEventListener('online', handleOnline);

        return () =>
        {
            cancelled = true;
            window.removeEventListener('online', handleOnline);
            clearTimeout(sendTimerRef.current);
            sendTimerRef.current = null;
            if (!socket) return;
            socket.disconnect();
            socketRef.current = null;
            if (window.__manhuntSocket === socket) delete window.__manhuntSocket;
        };
    }, [lobbyId, initialToken, hostKey, sendLatestLocation]);

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

    const send = useCallback((event, payload = {}) => emitWithAck(socketRef.current, event, payload), []);

    const updatePlayer = useCallback((updates) => send('update-player', updates), [send]);
    const setAvatar = useCallback((avatar) => send('set-avatar', { avatar }), [send]);

    // Refused by the server unless this player is the host
    const hostActions = useMemo(() => ({
        updateSettings: (settings) => send('update-settings', { settings }),
        startGame: () => send('start-game'),
        endGame: () => send('end-game'),
        resetGame: () => send('reset-game'),
        setRole: (playerId, isSeeker) => send('set-role', { player_id: playerId, is_seeker: isSeeker }),
        transferHost: (playerId) => send('transfer-host', { player_id: playerId }),
        kickPlayer: (playerId) => send('kick-player', { player_id: playerId })
    }), [send]);

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

    const selfPlayer = lobby.players.find((p) => p.player_id === selfId) ?? null;
    const players = useMemo(() => lobby.players.filter((p) => p.player_id !== selfId), [lobby.players, selfId]);

    return {
        joinState,
        lobbyName,
        selfPlayer,
        players,
        phase: lobby.phase,
        hostId: lobby.hostId,
        isHost: selfId !== null && lobby.hostId === selfId,
        settings: lobby.settings,
        game: lobby.game,
        avatars,
        clockOffset,
        connectionState,
        lastSyncTime,
        updateLocation,
        updatePlayer,
        setAvatar,
        hostActions,
        leaveLobby
    };
}

export default useLobbySocket;
