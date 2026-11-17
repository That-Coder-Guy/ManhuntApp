const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const { isAllowedOrigin } = require('./origins');
const { PHASE, DEFAULT_SETTINGS, applySettings, isOutOfBounds, isValidAvatar, nearestSeeker, seekerInfoFor } = require('./game');
const { cleanSubscription, createPushSender } = require('./push');

const API_PREFIX = '/manhunt-api';
// Which update this server is running: read from git once, at start-up
const VERSION = require('../shared/version.js').readVersion(path.join(__dirname, '..'));
const SOCKET_PATH = `${API_PREFIX}/socket.io`;

const DEFAULTS = {
    disconnectGraceMs: 5 * 60 * 1000, // keep a dropped player resumable this long
    awayWarningMs: 2 * 60 * 1000,     // a player away this long before removal is sent a reminder
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
    // Push notifications: { publicKey, send(subscription, payload) }. Tests
    // pass a stand-in; null turns pushes off
    const push = options.push === undefined ? createPushSender() : options.push;

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

    /**
     * The snapshot as one player may see it. During a game a hider gets no
     * one's position but their own, and instead whatever the lobby's
     * seeker_info setting allows (distance, a nearby alert, or nothing), so
     * a hider's phone never holds what the host chose to keep from it.
     */
    function viewFor(lobby, token, full)
    {
        const me = lobby.players.get(token);
        if (lobby.phase !== PHASE.PLAYING || me?.is_seeker) return full;
        const players = full.players.map((p) => (p.player_id === me?.player_id ? p : { ...p, latitude: null, longitude: null }));
        // (no player: a socket the lobby no longer has gets no positions at all)
        if (!me) return { ...full, players };
        return { ...full, players, seeker_info: seekerInfoFor(lobby.settings, me, [...lobby.players.values()], full.server_time) };
    }

    // Everyone in the lobby's room gets the state, each their own view of it
    function emitState(lobbyId, lobby)
    {
        const full = snapshot(lobby);
        if (lobby.phase !== PHASE.PLAYING) return io.to(lobbyId).emit('lobby-state', full);
        for (const socketId of io.sockets.adapter.rooms.get(lobbyId) ?? [])
        {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) socket.emit('lobby-state', viewFor(lobby, socket.data.token, full));
        }
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

        emitState(lobbyId, lobby);
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
        endIfNoHiders(lobbyId, lobby, { reason: 'no_hiders', winner: null });
        scheduleBroadcast(lobbyId);
    }

    /**
     * Push "Maya was found" to everyone else in the lobby who asked for
     * notifications and isn't looking at the app right now (they get the
     * in-app notice instead). A subscription the browser dropped is forgotten.
     */
    // Push to one player; a subscription the push service says is gone is forgotten
    function pushTo(player, payload, options)
    {
        const subscription = player.push_subscription;
        if (!push || !subscription) return;
        push.send(subscription, payload, options).then((result) =>
        {
            if (result?.gone && player.push_subscription === subscription) player.push_subscription = null;
        });
    }

    /**
     * A player who left the app (closed, or the phone locked and dropped the
     * connection) is removed after the grace period; shortly before, they're
     * reminded, so opening the app (or tapping the notice) keeps them in
     */
    function warnAway(lobbyId, lobby, player, now)
    {
        player.away_warned = true;
        const leftMs = player.disconnected_at + config.disconnectGraceMs - now;
        const minutes = Math.max(1, Math.round(leftMs / 60_000));
        const where = lobby.phase === PHASE.PLAYING ? 'the game' : 'the lobby';
        pushTo(player, {
            title: `Still playing in ${lobby.lobby_name}?`,
            body: `Open Manhunt within ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} or you'll be taken out of ${where}.`,
            url: `/lobby/${lobbyId}`,
            tag: `manhunt-${lobbyId}-away`,
        }, { ttl: Math.max(1, Math.floor(leftMs / 1000)) }); // worthless once they've been removed
    }

    function notifyFound(lobbyId, lobby, found, hidersLeft)
    {
        if (!push) return;
        const name = found.name || 'A hider';
        const payload = hidersLeft === 0
            ? { title: 'Everyone was found', body: `${name} was the last. The seekers win.` }
            : { title: `${name} was found`, body: `${hidersLeft} ${hidersLeft === 1 ? 'hider' : 'hiders'} left · ${lobby.lobby_name}` };
        payload.url = `/lobby/${lobbyId}`;
        payload.tag = `manhunt-${lobbyId}`; // a newer notice replaces an older one

        for (const p of lobby.players.values())
        {
            if (p === found) continue;
            if (p.connected && p.visible !== false) continue;
            pushTo(p, payload);
        }
    }

    // A running game ends once nobody is left hiding
    function endIfNoHiders(lobbyId, lobby, result)
    {
        if (lobby.phase !== PHASE.PLAYING) return;
        if ([...lobby.players.values()].some((p) => !p.is_seeker)) return;
        endGame(lobbyId, result);
    }

    function startGame(lobbyId, lobby)
    {
        const now = Date.now();
        const headStartEnds = now + lobby.settings.head_start_s * 1000;
        // Found hiders turn into seekers; this is what "Back to the lobby" restores
        for (const p of lobby.players.values()) p.role_at_start = p.is_seeker;
        lobby.phase = PHASE.PLAYING;
        lobby.game = {
            started_at: now,
            head_start_ends_at: headStartEnds,
            // The clock runs from when seekers are released
            ends_at: lobby.settings.time_limit_s ? headStartEnds + lobby.settings.time_limit_s * 1000 : null,
            ended_at: null,
            result: null,
            found: [],  // [{ player_id, at }] in the order hiders were found
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
                if (player.connected) continue;
                const away = now - player.disconnected_at;
                if (away >= config.disconnectGraceMs)
                {
                    removePlayer(lobbyId, token);
                }
                else if (!player.away_warned && away >= config.disconnectGraceMs - config.awayWarningMs)
                {
                    warnAway(lobbyId, lobby, player, now);
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

    // The version lets the landing page spot an app and server out of step
    app.get(`${API_PREFIX}/health`, (req, res) => res.json({ status: 'success', version: VERSION }));

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
        player.away_warned = false;
        player.socket_id = socket.id;
        socket.data.token = token;
        socket.join(lobbyId);

        socket.emit('joined', {
            lobby_name: lobby.lobby_name,
            player_token: token,
            player_id: player.player_id,
            state: viewFor(lobby, token, snapshot(lobby)),
            // What a phone needs to subscribe to this server's notifications
            push_public_key: push ? push.publicKey : null,
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

        // This phone's push subscription (or null to stop), for notifications
        on('push-subscribe', ({ subscription } = {}, ack, currentLobby, p) =>
        {
            if (subscription === null) p.push_subscription = null;
            else
            {
                const clean = cleanSubscription(subscription);
                if (!clean) return reply(ack, { status: 'validation_error', description: 'Not a push subscription this server accepts.' });
                p.push_subscription = clean;
            }
            reply(ack, { status: 'success' });
        });

        // Whether the app is on screen: notifications skip players looking at it
        on('set-visibility', ({ visible } = {}, ack, currentLobby, p) =>
        {
            if (typeof visible !== 'boolean') return reply(ack, { status: 'validation_error' });
            p.visible = visible;
            reply(ack, { status: 'success' });
        });

        // A hider a seeker has caught: within the lobby's found range of a
        // seeker with a recent fix, they declare it and join the seekers
        on('found', ({ latitude, longitude } = {}, ack, currentLobby, p) =>
        {
            const now = Date.now();
            const game = currentLobby.game;
            if (currentLobby.phase !== PHASE.PLAYING) return reply(ack, { status: 'wrong_phase', description: 'No game is running.' });
            if (p.is_seeker) return reply(ack, { status: 'already_seeker', description: "You're already a seeker." });
            if (now < game.head_start_ends_at) return reply(ack, { status: 'head_start', description: 'Seekers are still waiting out the head start.' });

            // The freshest position: the one the phone sends with the request
            if (isCoordinate(latitude, 90) && isCoordinate(longitude, 180))
            {
                p.latitude = latitude;
                p.longitude = longitude;
                p.location_last_updated = now;
            }
            const range = currentLobby.settings.found_range_m;
            const nearest = nearestSeeker(p, currentLobby.players.values(), now);
            if (!nearest || nearest.distance > range)
            {
                return reply(ack, { status: 'too_far', description: `No seeker is within ${range} m of you.` });
            }

            p.is_seeker = true;
            game.found = [...(game.found || []), { player_id: p.player_id, at: now }];
            const hidersLeft = [...currentLobby.players.values()].filter((q) => !q.is_seeker).length;
            io.to(lobbyId).emit('player-found', { player_id: p.player_id, name: p.name, hiders_left: hidersLeft });
            notifyFound(lobbyId, currentLobby, p, hidersLeft);
            endIfNoHiders(lobbyId, currentLobby, { reason: 'all_found', winner: 'seekers' });
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
            // Everyone goes back to the role they started the round with
            for (const p of currentLobby.players.values())
            {
                if (typeof p.role_at_start === 'boolean') p.is_seeker = p.role_at_start;
                delete p.role_at_start;
            }
            scheduleBroadcast(lobbyId);
            reply(ack, { status: 'success' });
        }, { hostOnly: true });

        on('set-role', ({ player_id: playerId, is_seeker: isSeeker }, ack, currentLobby) =>
        {
            const [, target] = findPlayer(currentLobby, playerId);
            if (!target || typeof isSeeker !== 'boolean') return reply(ack, { status: 'validation_error' });
            target.is_seeker = isSeeker;
            endIfNoHiders(lobbyId, currentLobby, { reason: 'all_found', winner: 'seekers' });
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
            p.away_warned = false;
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
