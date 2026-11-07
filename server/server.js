const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const { isAllowedOrigin } = require('./origins');

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

function publicPlayerData(player)
{
    return {
        player_id: player.player_id,
        name: player.name,
        is_seeker: player.is_seeker,
        latitude: player.latitude,
        longitude: player.longitude,
        location_last_updated: player.location_last_updated,
        connected: player.connected
    };
}

/**
 * Build the game server without listening, so tests can run it on a random
 * port and shut it down cleanly.
 *
 * State lives in Maps, never plain objects: lobby IDs and player tokens come
 * straight from clients, and a key like "__proto__" or "constructor" must look
 * up nothing rather than Object.prototype.
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
        cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true }
    });

    /** @type {Map<string, {lobby_name: string, next_player_id: number, players: Map<string, object>, created_at: number, broadcastTimer: NodeJS.Timeout|null, broadcastPending: boolean}>} */
    const lobbies = new Map();

    function emitLobbyState(lobbyId)
    {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;
        const players = [...lobby.players.values()].map(publicPlayerData);
        io.to(lobbyId).emit('lobby-state', { players });
    }

    // Push the player list now, or — if one went out within the interval —
    // once more when the interval ends, so bursts collapse into one update
    function scheduleBroadcast(lobbyId)
    {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        if (lobby.broadcastTimer)
        {
            lobby.broadcastPending = true;
            return;
        }

        emitLobbyState(lobbyId);
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

    function deleteLobby(lobbyId)
    {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;
        clearTimeout(lobby.broadcastTimer);
        lobbies.delete(lobbyId);
    }

    // The one way a player leaves: an empty lobby goes with them
    function removePlayer(lobbyId, token)
    {
        const lobby = lobbies.get(lobbyId);
        if (!lobby || !lobby.players.delete(token)) return;

        if (lobby.players.size === 0) deleteLobby(lobbyId);
        else scheduleBroadcast(lobbyId);
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

    // --- REST: lobby creation happens before any socket exists ---
    app.post(`${API_PREFIX}/create-lobby`, (req, res) =>
    {
        const lobbyName = req.body?.lobby_name;
        if (typeof lobbyName !== 'string' || !lobbyName.trim())
        {
            return res.status(400).json({ status: 'missing_parameter', description: 'lobby_name is required.' });
        }

        const lobbyId = uuidv4();
        lobbies.set(lobbyId, {
            lobby_name: lobbyName.trim().slice(0, config.maxNameLength),
            next_player_id: 1,
            players: new Map(),
            created_at: Date.now(),
            broadcastTimer: null,
            broadcastPending: false
        });
        res.json({ status: 'success', lobby_id: lobbyId });
    });

    app.get(`${API_PREFIX}/health`, (req, res) => res.json({ status: 'success' }));

    // Malformed JSON and the like: answer in the API's own shape, not HTML
    app.use(API_PREFIX, (err, req, res, next) =>
    {
        if (res.headersSent) return next(err);
        res.status(err.status || 400).json({ status: 'bad_request', description: 'Invalid request.' });
    });

    // --- Socket.IO: join/resume, then live updates ---
    io.on('connection', (socket) =>
    {
        const { lobby_id: lobbyId, player_token: providedToken } = socket.handshake.auth || {};

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
            // Removed after the grace period, or left: the client decides whether to rejoin fresh
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
                latitude: null,
                longitude: null,
                location_last_updated: null,
                connected: true,
                disconnected_at: null,
                socket_id: null
            };
            lobby.players.set(token, player);
        }

        player.connected = true;
        player.disconnected_at = null;
        player.socket_id = socket.id;
        socket.join(lobbyId);

        socket.emit('joined', {
            lobby_name: lobby.lobby_name,
            player_token: token,
            player_data: publicPlayerData(player)
        });
        scheduleBroadcast(lobbyId);

        // The player can be removed (left elsewhere, grace expired) while this
        // socket is still open, so every event re-resolves it
        const currentPlayer = () => lobbies.get(lobbyId)?.players.get(token);

        socket.on('update-location', (data, ack) =>
        {
            const p = currentPlayer();
            if (!p) return reply(ack, { status: 'invalid_player_token' });

            const { latitude, longitude } = data || {};
            if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180))
            {
                return reply(ack, { status: 'validation_error' });
            }

            p.latitude = latitude;
            p.longitude = longitude;
            p.location_last_updated = Date.now();
            scheduleBroadcast(lobbyId);
            reply(ack, { status: 'success' });
        });

        socket.on('update-player', (data, ack) =>
        {
            const p = currentPlayer();
            if (!p) return reply(ack, { status: 'invalid_player_token' });

            const { name, is_seeker: isSeeker } = data || {};
            const hasName = typeof name === 'string' && name.trim().length > 0;
            const hasRole = typeof isSeeker === 'boolean';
            if (!hasName && !hasRole) return reply(ack, { status: 'validation_error' });

            if (hasName) p.name = name.trim().slice(0, config.maxNameLength);
            if (hasRole) p.is_seeker = isSeeker;

            scheduleBroadcast(lobbyId);
            reply(ack, { status: 'success', player_data: publicPlayerData(p) });
        });

        socket.on('leave-lobby', (...args) =>
        {
            // The ack is always the last argument, whatever payload came first
            removePlayer(lobbyId, token);
            reply(args[args.length - 1], { status: 'success' });
            socket.disconnect(true);
        });

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
    const distDir = options.distDir ?? path.join(__dirname, '..', 'dist');
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
        if (fs.existsSync(distDir)) console.log(`Serving frontend from ${distDir}`);
    });

    // Let in-flight sockets close cleanly on Ctrl-C / container stop
    for (const signal of ['SIGINT', 'SIGTERM'])
    {
        process.on(signal, () => close().finally(() => process.exit(0)));
    }
}

module.exports = { createGameServer, SOCKET_PATH, DEFAULTS };
