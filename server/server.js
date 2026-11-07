const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const { isAllowedOrigin } = require('./origins');
const { PHASE, DEFAULT_SETTINGS, applySettings, isOutOfBounds, isValidAvatar } = require('./game');

const API_PREFIX = '/manhunt-api';
const SOCKET_PATH = `${API_PREFIX}/socket.io`;

const DEFAULTS = {
    disconnectGraceMs: 5 * 60 * 1000, // keep a dropped player resumable this long
    lobbyGraceMs: 10 * 1000,          // a new, empty lobby waits this long for its creator
    cleanupIntervalMs: 30 * 1000,     // sweep for expired players and lobbies
    broadcastIntervalMs: 1000,        // at most one lobby-state push per lobby per second
    maxPlayersPerLobby: 50,
    maxNameLength: 30,
};

// cors' `origin` option takes (origin, callback); Socket.IO uses the same package
function corsOrigin(origin, callback)
{
    callback(null, isAllowedOrigin(origin));
}

const isString = (value) => typeof value === 'string' && value.length > 0;
const isCoordinate = (value, limit) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

// Call a Socket.IO acknowledgement if the client sent one
function reply(ack, payload)
{
    if (typeof ack === 'function') ack(payload);
}

/**
 * Build the game server without listening, so tests can run it on a random
 * port and shut it down cleanly.
 *
 * State lives in Maps, never plain objects: lobby IDs and player tokens come
 * straight from clients, and a key like "__proto__" or "constructor" must look
 * up nothing rather than Object.prototype.
 *
 * Authority: whoever holds the lobby's host key (returned only to the creator)
 * is the host. Settings, starting and ending the game, roles of other players,
 * removing players and handing over the host role are host-only, checked here.
 */
function createGameServer(options = {})
{
    const config = { ...DEFAULTS, ...options };

    const app = express();
    app.use(cors({
        origin: corsOrigin,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type'],
        credentials: true
    }));
    app.use(express.json({ limit: '10kb' }));

    const server = http.createServer(app);
    const io = new Server(server, {
        path: SOCKET_PATH,
        maxHttpBufferSize: 100_000, // avatars are the largest messages (~40 KB max)
        cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true }
    });

    const lobbies = new Map();

    // ---- Views ----

    function publicPlayerData(lobby, token, player, now)
    {
        const game = lobby.game;
        // Positions are only shared while a game runs, and hiders stay hidden
        // until the head start is over: the server, not the client, decides
        const showPosition = lobby.phase === PHASE.PLAYING
            && (player.is_seeker || !game || now >= game.head_start_ends_at);

        return {
            player_id: player.player_id,
            name: player.name,
            is_seeker: player.is_seeker,
            is_host: token === lobby.host_token,
            connected: player.connected,
            avatar_rev: player.avatar_rev,
            latitude: showPosition ? player.latitude : null,
            longitude: showPosition ? player.longitude : null,
            location_last_updated: player.location_last_updated,
            out_of_bounds: lobby.phase === PHASE.PLAYING && isOutOfBounds(lobby.settings.geofence, player),
        };
    }

    function snapshot(lobby)
    {
        const now = Date.now();
        const host = lobby.players.get(lobby.host_token);
        return {
            phase: lobby.phase,
            host_id: host ? host.player_id : null,
            settings: lobby.settings,
            game: lobby.game,
            server_time: now,
            players: [...lobby.players].map(([token, player]) => publicPlayerData(lobby, token, player, now)),
        };
    }

    // Push the lobby now, or — if a push went out within the interval — once
    // more when the interval ends, so bursts collapse into one update
    function scheduleBroadcast(lobbyId)
    {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        if (lobby.broadcastTimer)
        {
            lobby.broadcastPending = true;
            return;
        }

        io.to(lobbyId).emit('lobby-state', snapshot(lobby));
        lobby.broadcastTimer = setTimeout(() =>
        {
            lobby.broadcastTimer = null;
            if (lobby.broadcastPending)
            {
                lobby.broadcastPending = false;
                scheduleBroadcast(lobbyId);
            }
        }, config.broadcastIntervalMs);
    }

    // ---- Lifecycle ----

    function clearGameTimers(lobby)
    {
        clearTimeout(lobby.headStartTimer);
        clearTimeout(lobby.endTimer);
        lobby.headStartTimer = null;
        lobby.endTimer = null;
    }

    function deleteLobby(lobbyId)
    {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;
        clearTimeout(lobby.broadcastTimer);
        clearGameTimers(lobby);
        lobbies.delete(lobbyId);
    }

    // Earliest-joined player, preferring someone currently connected
    function chooseNewHost(lobby)
    {
        const candidates = [...lobby.players].sort(([, a], [, b]) =>
            (b.connected - a.connected) || (a.player_id - b.player_id));
        lobby.host_token = candidates.length ? candidates[0][0] : null;
    }

    // The one way a player leaves: the host role moves on, an empty lobby goes
    function removePlayer(lobbyId, token)
    {
        const lobby = lobbies.get(lobbyId);
        if (!lobby || !lobby.players.delete(token)) return;

        if (lobby.players.size === 0) return deleteLobby(lobbyId);
        if (lobby.host_token === token) chooseNewHost(lobby);
        scheduleBroadcast(lobbyId);
    }

    function startGame(lobbyId, lobby)
    {
        const now = Date.now();
        const headStartEnds = now + lobby.settings.head_start_s * 1000;
        lobby.phase = PHASE.PLAYING;
        lobby.game = {
            started_at: now,
            head_start_ends_at: headStartEnds,
            // The clock runs from when seekers are released
            ends_at: lobby.settings.time_limit_s ? headStartEnds + lobby.settings.time_limit_s * 1000 : null,
            ended_at: null,
            result: null,
        };

        clearGameTimers(lobby);
        if (lobby.settings.head_start_s)
        {
            // Hider positions become visible the moment the head start ends
            lobby.headStartTimer = setTimeout(() => scheduleBroadcast(lobbyId), headStartEnds - now);
        }
        if (lobby.game.ends_at)
        {
            lobby.endTimer = setTimeout(() => endGame(lobbyId, { reason: 'time_up', winner: 'hiders' }),
                lobby.game.ends_at - now);
        }
        scheduleBroadcast(lobbyId);
    }

    function endGame(lobbyId, result)
    {
        const lobby = lobbies.get(lobbyId);
        if (!lobby || lobby.phase !== PHASE.PLAYING) return;
        clearGameTimers(lobby);
        lobby.phase = PHASE.ENDED;
        lobby.game = { ...lobby.game, ended_at: Date.now(), result };
        scheduleBroadcast(lobbyId);
    }

    function cleanupExpired()
    {
        const now = Date.now();
        for (const [lobbyId, lobby] of lobbies)
        {
            for (const [token, player] of lobby.players)
            {
                if (!player.connected && now - player.disconnected_at >= config.disconnectGraceMs)
                {
                    removePlayer(lobbyId, token);
                }
            }
            // Lobbies nobody ever joined
            if (lobbies.has(lobbyId) && lobby.players.size === 0 && now - lobby.created_at >= config.lobbyGraceMs)
            {
                deleteLobby(lobbyId);
            }
        }
    }
    const cleanupTimer = setInterval(cleanupExpired, config.cleanupIntervalMs);
    cleanupTimer.unref();

    // ---- REST: lobby creation happens before any socket exists ----
    app.post(`${API_PREFIX}/create-lobby`, (req, res) =>
    {
        const lobbyName = req.body?.lobby_name;
        if (typeof lobbyName !== 'string' || !lobbyName.trim())
        {
            return res.status(400).json({ status: 'missing_parameter', description: 'lobby_name is required.' });
        }

        const lobbyId = uuidv4();
        const hostKey = crypto.randomBytes(24).toString('base64url');
        lobbies.set(lobbyId, {
            lobby_name: lobbyName.trim().slice(0, config.maxNameLength),
            host_key: hostKey,
            host_token: null,
            next_player_id: 1,
            players: new Map(),
            created_at: Date.now(),
            phase: PHASE.LOBBY,
            settings: { ...DEFAULT_SETTINGS },
            game: null,
            broadcastTimer: null,
            broadcastPending: false,
            headStartTimer: null,
            endTimer: null,
        });
        // The host key goes only to the creator; whoever presents it is host
        res.json({ status: 'success', lobby_id: lobbyId, host_key: hostKey });
    });

    app.get(`${API_PREFIX}/health`, (req, res) => res.json({ status: 'success' }));

    // Malformed JSON and the like: answer in the API's own shape, not HTML
    app.use(API_PREFIX, (err, req, res, next) =>
    {
        if (res.headersSent) return next(err);
        res.status(err.status || 400).json({ status: 'bad_request', description: 'Invalid request.' });
    });

    // ---- Socket.IO: join/resume, then live updates ----
    io.on('connection', (socket) =>
    {
        const { lobby_id: lobbyId, player_token: providedToken, host_key: hostKey } = socket.handshake.auth || {};

        function fail(status, description)
        {
            socket.emit('fatal-error', { status, description });
            socket.disconnect(true);
        }

        const lobby = isString(lobbyId) ? lobbies.get(lobbyId) : undefined;
        if (!lobby) return fail('lobby_not_found', 'Lobby does not exist.');

        let token;
        let player;
        if (providedToken)
        {
            player = isString(providedToken) ? lobby.players.get(providedToken) : undefined;
            // Removed after the grace period, left, or was removed by the host
            if (!player) return fail('invalid_player_token', 'No player with this token is in the lobby.');
            token = providedToken;
        }
        else
        {
            if (lobby.players.size >= config.maxPlayersPerLobby) return fail('lobby_full', 'This lobby is full.');

            token = uuidv4();
            const playerId = lobby.next_player_id++;
            player = {
                player_id: playerId,
                name: `Player ${playerId}`,
                is_seeker: false,
                avatar: null,
                avatar_rev: 0,
                latitude: null,
                longitude: null,
                location_last_updated: null,
                connected: true,
                disconnected_at: null,
                socket_id: null
            };
            lobby.players.set(token, player);
        }

        // The creator's key always (re)claims the host role; a lobby without a
        // host (key never used) gives it to whoever is there
        if (isString(hostKey) && hostKey === lobby.host_key) lobby.host_token = token;
        else if (!lobby.players.has(lobby.host_token)) lobby.host_token = token;

        player.connected = true;
        player.disconnected_at = null;
        player.socket_id = socket.id;
        socket.join(lobbyId);

        socket.emit('joined', {
            lobby_name: lobby.lobby_name,
            player_token: token,
            player_id: player.player_id,
            state: snapshot(lobby),
        });
        // Pictures travel separately from the per-second state, once each
        const avatars = {};
        for (const p of lobby.players.values()) if (p.avatar) avatars[p.player_id] = p.avatar;
        socket.emit('avatars', { avatars });
        scheduleBroadcast(lobbyId);

        // The player can be removed (left elsewhere, grace expired, kicked)
        // while this socket is open, so every event re-resolves it
        const currentPlayer = () => lobbies.get(lobbyId)?.players.get(token);

        // Register a handler that always gets (data, ack), never throws past
        // here, and is refused once this player is gone
        function on(event, handler, { hostOnly = false } = {})
        {
            socket.on(event, (...args) =>
            {
                const ack = typeof args[args.length - 1] === 'function' ? args.pop() : undefined;
                const data = args[0] && typeof args[0] === 'object' ? args[0] : {};
                const currentLobby = lobbies.get(lobbyId);
                const p = currentPlayer();
                if (!currentLobby || !p) return reply(ack, { status: 'invalid_player_token' });
                if (hostOnly && currentLobby.host_token !== token)
                {
                    return reply(ack, { status: 'forbidden', description: 'Only the host can do that.' });
                }
                try {
                    handler(data, ack, currentLobby, p);
                } catch (error) {
                    console.error(`Error handling ${event}:`, error);
                    reply(ack, { status: 'error', description: 'Something went wrong.' });
                }
            });
        }

        // Find another player by public ID
        function findPlayer(currentLobby, playerId)
        {
            for (const [t, p] of currentLobby.players) if (p.player_id === playerId) return [t, p];
            return [null, null];
        }

        // ---- Everyone ----

        on('update-location', ({ latitude, longitude }, ack, currentLobby, p) =>
        {
            if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180))
            {
                return reply(ack, { status: 'validation_error' });
            }
            p.latitude = latitude;
            p.longitude = longitude;
            p.location_last_updated = Date.now();
            // Nobody sees positions outside a game, so no need to push then
            if (currentLobby.phase === PHASE.PLAYING) scheduleBroadcast(lobbyId);
            reply(ack, { status: 'success' });
        });

        on('update-player', ({ name, is_seeker: isSeeker }, ack, currentLobby, p) =>
        {
            const hasName = typeof name === 'string' && name.trim().length > 0;
            const hasRole = typeof isSeeker === 'boolean';
            if (!hasName && !hasRole) return reply(ack, { status: 'validation_error' });
            // Roles are picked before the game; after that only the host moves people
            if (hasRole && currentLobby.phase !== PHASE.LOBBY && isSeeker !== p.is_seeker)
            {
                return reply(ack, { status: 'role_locked', description: 'Roles are locked once the game starts.' });
            }

            if (hasName) p.name = name.trim().slice(0, config.maxNameLength);
            if (hasRole) p.is_seeker = isSeeker;
            scheduleBroadcast(lobbyId);
            reply(ack, { status: 'success', player_data: publicPlayerData(currentLobby, token, p, Date.now()) });
        });

        on('set-avatar', ({ avatar }, ack, currentLobby, p) =>
        {
            if (avatar === undefined || !isValidAvatar(avatar)) return reply(ack, { status: 'validation_error' });
            p.avatar = avatar;
            p.avatar_rev += 1;
            io.to(lobbyId).emit('avatar', { player_id: p.player_id, avatar });
            scheduleBroadcast(lobbyId);
            reply(ack, { status: 'success' });
        });

        on('leave-lobby', (data, ack) =>
        {
            removePlayer(lobbyId, token);
            reply(ack, { status: 'success' });
            socket.disconnect(true);
        });

        // ---- Host only ----

        on('update-settings', ({ settings }, ack, currentLobby) =>
        {
            if (currentLobby.phase !== PHASE.LOBBY)
            {
                return reply(ack, { status: 'wrong_phase', description: 'Settings can only change before the game.' });
            }
            const result = applySettings(currentLobby.settings, settings);
            if (result.error) return reply(ack, { status: 'validation_error', description: result.error });
            currentLobby.settings = result.settings;
            scheduleBroadcast(lobbyId);
            reply(ack, { status: 'success', settings: currentLobby.settings });
        }, { hostOnly: true });

        on('start-game', (data, ack, currentLobby) =>
        {
            if (currentLobby.phase !== PHASE.LOBBY) return reply(ack, { status: 'wrong_phase', description: 'The game has already started.' });
            const roles = [...currentLobby.players.values()].map((p) => p.is_seeker);
            if (!roles.includes(true) || !roles.includes(false))
            {
                return reply(ack, { status: 'need_both_roles', description: 'You need at least one seeker and one hider.' });
            }
            startGame(lobbyId, currentLobby);
            reply(ack, { status: 'success' });
        }, { hostOnly: true });

        on('end-game', (data, ack, currentLobby) =>
        {
            if (currentLobby.phase !== PHASE.PLAYING) return reply(ack, { status: 'wrong_phase', description: 'No game is running.' });
            endGame(lobbyId, { reason: 'host_ended', winner: null });
            reply(ack, { status: 'success' });
        }, { hostOnly: true });

        on('reset-game', (data, ack, currentLobby) =>
        {
            if (currentLobby.phase === PHASE.LOBBY) return reply(ack, { status: 'success' });
            clearGameTimers(currentLobby);
            currentLobby.phase = PHASE.LOBBY;
            currentLobby.game = null;
            scheduleBroadcast(lobbyId);
            reply(ack, { status: 'success' });
        }, { hostOnly: true });

        on('set-role', ({ player_id: playerId, is_seeker: isSeeker }, ack, currentLobby) =>
        {
            const [, target] = findPlayer(currentLobby, playerId);
            if (!target || typeof isSeeker !== 'boolean') return reply(ack, { status: 'validation_error' });
            target.is_seeker = isSeeker;
            scheduleBroadcast(lobbyId);
            reply(ack, { status: 'success' });
        }, { hostOnly: true });

        on('transfer-host', ({ player_id: playerId }, ack, currentLobby) =>
        {
            const [targetToken] = findPlayer(currentLobby, playerId);
            if (!targetToken) return reply(ack, { status: 'validation_error' });
            currentLobby.host_token = targetToken;
            scheduleBroadcast(lobbyId);
            reply(ack, { status: 'success' });
        }, { hostOnly: true });

        on('kick-player', ({ player_id: playerId }, ack, currentLobby) =>
        {
            const [targetToken, target] = findPlayer(currentLobby, playerId);
            if (!target || targetToken === token) return reply(ack, { status: 'validation_error' });

            const targetSocket = target.socket_id && io.sockets.sockets.get(target.socket_id);
            removePlayer(lobbyId, targetToken);
            if (targetSocket)
            {
                targetSocket.emit('fatal-error', { status: 'kicked', description: 'The host removed you from the lobby.' });
                targetSocket.disconnect(true);
            }
            reply(ack, { status: 'success' });
        }, { hostOnly: true });

        socket.on('disconnect', () =>
        {
            const p = currentPlayer();
            // Ignore a stale socket that a newer connection already replaced
            if (!p || p.socket_id !== socket.id) return;

            p.connected = false;
            p.disconnected_at = Date.now();
            p.socket_id = null;
            scheduleBroadcast(lobbyId);
        });
    });

    // Serve the built frontend (single-origin deployment) when dist/ exists
    const distDir = options.distDir === undefined ? path.join(__dirname, '..', 'dist') : options.distDir;
    if (distDir && fs.existsSync(distDir))
    {
        app.use(express.static(distDir));
        app.get(/^\/(?!manhunt-api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
    }

    function close()
    {
        clearInterval(cleanupTimer);
        for (const lobbyId of [...lobbies.keys()]) deleteLobby(lobbyId);
        return new Promise((resolve) => io.close(() => resolve()));
    }

    return { app, server, io, lobbies, cleanupExpired, close, distDir };
}

if (require.main === module)
{
    const { server, distDir, close } = createGameServer();
    const port = Number(process.env.PORT) || 3001;

    server.listen(port, '0.0.0.0', () =>
    {
        console.log(`API listening on http://0.0.0.0:${port}`);
        if (distDir && fs.existsSync(distDir)) console.log(`Serving frontend from ${distDir}`);
    });

    // Let in-flight sockets close cleanly on Ctrl-C / container stop
    for (const signal of ['SIGINT', 'SIGTERM'])
    {
        process.on(signal, () => close().finally(() => process.exit(0)));
    }
}

module.exports = { createGameServer, SOCKET_PATH, DEFAULTS };
