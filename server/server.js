const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const ALLOWED_ORIGINS = [
    "https://people.cs.ksu.edu",
    "https://gil-rigoristic-eleanor.ngrok-free.dev",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
];

const app = express();
app.use(cors({
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    path: '/manhunt-api/socket.io',
    cors: {
        origin: ALLOWED_ORIGINS,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

const lobbies = {};

// Timeout configuration
const DISCONNECT_GRACE_PERIOD = 5 * 60 * 1000; // Keep disconnected players for 5 minutes
const CLEANUP_CHECK_INTERVAL = 30 * 1000;      // Sweep for expired players/lobbies every 30 seconds
const LOBBY_GRACE_PERIOD = 10 * 1000;          // Empty-lobby grace period so creators can join
const BROADCAST_MIN_INTERVAL = 1000;           // At most one lobby-state broadcast per second per lobby
const MAX_NAME_LENGTH = 30;

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

// Broadcast the full player list to everyone in the lobby, throttled per lobby.
// If a broadcast just went out, coalesce further changes into one trailing send.
function scheduleBroadcast(lobby_id)
{
    const lobby = lobbies[lobby_id];
    if (!lobby) return;

    if (lobby.broadcast_timer)
    {
        lobby.broadcast_pending = true;
        return;
    }

    emitLobbyState(lobby_id);
    lobby.broadcast_timer = setTimeout(() =>
    {
        lobby.broadcast_timer = null;
        if (lobby.broadcast_pending && lobbies[lobby_id])
        {
            lobby.broadcast_pending = false;
            scheduleBroadcast(lobby_id);
        }
    }, BROADCAST_MIN_INTERVAL);
}

function emitLobbyState(lobby_id)
{
    const lobby = lobbies[lobby_id];
    if (!lobby) return;

    const players = Object.values(lobby.player_data).map(publicPlayerData);
    io.to(lobby_id).emit('lobby-state', { players });
}

function deleteLobby(lobby_id)
{
    const lobby = lobbies[lobby_id];
    if (!lobby) return;

    if (lobby.broadcast_timer)
    {
        clearTimeout(lobby.broadcast_timer);
    }
    delete lobbies[lobby_id];
    console.log(`Removed lobby ${lobby_id}`);
}

// Periodic sweep: remove players whose disconnect grace period expired,
// then remove lobbies that have been empty past the lobby grace period.
function cleanupExpired()
{
    const now = Date.now();

    for (const lobby_id of Object.keys(lobbies))
    {
        const lobby = lobbies[lobby_id];
        let changed = false;

        for (const [token, player] of Object.entries(lobby.player_data))
        {
            if (!player.connected && now - player.disconnected_at >= DISCONNECT_GRACE_PERIOD)
            {
                delete lobby.player_data[token];
                changed = true;
                console.log(`Removed player ${player.player_id} from lobby ${lobby_id} (disconnect grace expired)`);
            }
        }

        if (Object.keys(lobby.player_data).length === 0)
        {
            if (now - lobby.created_at >= LOBBY_GRACE_PERIOD)
            {
                deleteLobby(lobby_id);
            }
        }
        else if (changed)
        {
            scheduleBroadcast(lobby_id);
        }
    }
}

// --- Create Lobby (REST, happens before any socket exists) ---
app.post("/manhunt-api/create-lobby", (req, res) =>
{
    const { lobby_name } = req.body;
    if (typeof lobby_name !== 'string' || !lobby_name.trim())
    {
        return res.status(400).json({
            status: "missing_parameter",
            description: "lobby_name parameter was not provided."
        });
    }

    const lobby_id = uuidv4();
    lobbies[lobby_id] = {
        lobby_name: lobby_name.trim().slice(0, MAX_NAME_LENGTH),
        next_player_id: 1,
        player_data: {},
        created_at: Date.now(),
        broadcast_timer: null,
        broadcast_pending: false
    };

    res.json({
        status: "success",
        lobby_id: lobby_id
    });
});

app.get("/manhunt-api/health", (req, res) =>
{
    res.json({ status: "success" });
});

function isValidLatitude(value)
{
    return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value)
{
    return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

io.on('connection', (socket) =>
{
    const auth = socket.handshake.auth || {};
    const lobby_id = auth.lobby_id;
    const provided_token = auth.player_token;

    const lobby = lobby_id ? lobbies[lobby_id] : undefined;
    if (!lobby)
    {
        socket.emit('fatal-error', { status: 'lobby_not_found', description: 'Lobby does not exist' });
        socket.disconnect(true);
        return;
    }

    let player_token;
    let player;

    if (provided_token)
    {
        player = lobby.player_data[provided_token];
        if (!player)
        {
            // Token exists but the player was removed (grace period expired or they left).
            // Let the client decide whether to rejoin as a new player.
            socket.emit('fatal-error', {
                status: 'invalid_player_token',
                description: 'A player with this token does not exist in the lobby.'
            });
            socket.disconnect(true);
            return;
        }
        player_token = provided_token;
    }
    else
    {
        player_token = uuidv4();
        const player_id = lobby.next_player_id++;
        player = {
            player_id: player_id,
            name: `Player ${player_id}`,
            is_seeker: false,
            latitude: null,
            longitude: null,
            location_last_updated: null,
            connected: true,
            disconnected_at: null,
            socket_id: null
        };
        lobby.player_data[player_token] = player;
    }

    // Join / resume
    player.connected = true;
    player.disconnected_at = null;
    player.socket_id = socket.id;
    socket.join(lobby_id);

    socket.emit('joined', {
        lobby_name: lobby.lobby_name,
        player_token: player_token,
        player_data: publicPlayerData(player)
    });
    scheduleBroadcast(lobby_id);

    // Guard against events arriving after the player left or was removed
    function currentPlayer()
    {
        const currentLobby = lobbies[lobby_id];
        return currentLobby ? currentLobby.player_data[player_token] : undefined;
    }

    socket.on('update-location', (data, ack) =>
    {
        const p = currentPlayer();
        if (!p)
        {
            if (typeof ack === 'function') ack({ status: 'invalid_player_token' });
            return;
        }

        const { latitude, longitude } = data || {};
        if (!isValidLatitude(latitude) || !isValidLongitude(longitude))
        {
            if (typeof ack === 'function') ack({ status: 'validation_error' });
            return;
        }

        p.latitude = latitude;
        p.longitude = longitude;
        p.location_last_updated = Date.now();
        scheduleBroadcast(lobby_id);

        if (typeof ack === 'function') ack({ status: 'success' });
    });

    socket.on('update-player', (data, ack) =>
    {
        const p = currentPlayer();
        if (!p)
        {
            if (typeof ack === 'function') ack({ status: 'invalid_player_token' });
            return;
        }

        const { name, is_seeker } = data || {};
        let updated = false;

        if (typeof name === 'string' && name.trim().length > 0)
        {
            p.name = name.trim().slice(0, MAX_NAME_LENGTH);
            updated = true;
        }
        if (typeof is_seeker === 'boolean')
        {
            p.is_seeker = is_seeker;
            updated = true;
        }

        if (!updated)
        {
            if (typeof ack === 'function') ack({ status: 'validation_error' });
            return;
        }

        scheduleBroadcast(lobby_id);
        if (typeof ack === 'function') ack({ status: 'success', player_data: publicPlayerData(p) });
    });

    socket.on('leave-lobby', (...args) =>
    {
        const ack = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
        const currentLobby = lobbies[lobby_id];
        if (currentLobby && currentLobby.player_data[player_token])
        {
            delete currentLobby.player_data[player_token];
            if (Object.keys(currentLobby.player_data).length === 0)
            {
                deleteLobby(lobby_id);
            }
            else
            {
                scheduleBroadcast(lobby_id);
            }
        }
        if (typeof ack === 'function') ack({ status: 'success' });
        socket.disconnect(true);
    });

    socket.on('disconnect', () =>
    {
        const p = currentPlayer();
        // Ignore disconnects from stale sockets replaced by a newer connection
        if (!p || p.socket_id !== socket.id) return;

        p.connected = false;
        p.disconnected_at = Date.now();
        p.socket_id = null;
        scheduleBroadcast(lobby_id);
    });
});

// Serve the built frontend (single-origin deployment) when dist/ exists.
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir))
{
    app.use(express.static(distDir));
    app.get(/^\/(?!manhunt-api).*/, (req, res) =>
    {
        res.sendFile(path.join(distDir, 'index.html'));
    });
    console.log(`Serving frontend from ${distDir}`);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () =>
{
    console.log(`API listening on http://0.0.0.0:${PORT}`);
});

setInterval(cleanupExpired, CLEANUP_CHECK_INTERVAL);
