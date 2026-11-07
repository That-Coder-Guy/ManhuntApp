import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { io as connect } from 'socket.io-client';

const require = createRequire(import.meta.url);

// The server has its own dependencies (server/package.json)
let createGameServer;
let SOCKET_PATH;
let loadError = null;
try {
    ({ createGameServer, SOCKET_PATH } = require('../server/server.js'));
} catch (error) {
    loadError = error;
}
const skip = loadError ? `server deps missing — run \`npm --prefix server install\` (${loadError.message})` : false;

let game;
let base;
const sockets = [];

before(async () => {
    if (skip) return;
    game = createGameServer({ distDir: null, broadcastIntervalMs: 20, maxPlayersPerLobby: 3, cleanupIntervalMs: 60_000 });
    await new Promise((resolve) => game.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${game.server.address().port}`;
});

after(async () => {
    if (skip) return;
    sockets.forEach((s) => s.disconnect());
    await game.close();
});

async function createLobby(name = 'Test lobby') {
    const res = await fetch(`${base}/manhunt-api/create-lobby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lobby_name: name })
    });
    return { status: res.status, body: await res.json() };
}

// Connect and resolve with the first of `joined` / `fatal-error`
function join(auth) {
    const socket = connect(base, { path: SOCKET_PATH, auth, reconnection: false, transports: ['websocket'] });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no join response')), 3000);
        socket.once('joined', (data) => { clearTimeout(timer); resolve({ socket, event: 'joined', data }); });
        socket.once('fatal-error', (data) => { clearTimeout(timer); resolve({ socket, event: 'fatal-error', data }); });
    });
}

const ack = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);
// This player's own entry in the snapshot sent with `joined`
const me = (joined) => joined.data.state.players.find((p) => p.player_id === joined.data.player_id);
// Resolve with the next lobby-state matching a predicate
function nextState(socket, predicate = () => true, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off('lobby-state', handler); reject(new Error('no matching lobby-state')); }, timeoutMs);
        function handler(state) { if (predicate(state)) { clearTimeout(timer); socket.off('lobby-state', handler); resolve(state); } }
        socket.on('lobby-state', handler);
    });
}

test('creates a lobby and rejects a missing or malformed name', { skip }, async () => {
    const ok = await createLobby('  Riverside  ');
    assert.equal(ok.status, 200);
    assert.match(ok.body.lobby_id, /^[0-9a-f-]{36}$/);
    assert.ok(ok.body.host_key.length >= 24, 'creator gets a host key');
    assert.equal(game.lobbies.get(ok.body.lobby_id).lobby_name, 'Riverside');

    assert.equal((await createLobby('   ')).status, 400);

    const bad = await fetch(`${base}/manhunt-api/create-lobby`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json'
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).status, 'bad_request');
});

test('joins, then resumes the same identity with the token', { skip }, async () => {
    const { body } = await createLobby();
    const first = await join({ lobby_id: body.lobby_id });
    assert.equal(first.event, 'joined');
    assert.equal(me(first).name, 'Player 1');

    first.socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    const player = game.lobbies.get(body.lobby_id).players.get(first.data.player_token);
    assert.equal(player.connected, false, 'disconnect keeps the player, marked offline');

    const again = await join({ lobby_id: body.lobby_id, player_token: first.data.player_token });
    assert.equal(again.event, 'joined');
    assert.equal(again.data.player_id, first.data.player_id);
    assert.equal(me(again).connected, true);
});

test('prototype-like lobby IDs and tokens are rejected and the server survives', { skip }, async () => {
    for (const lobby_id of ['__proto__', 'constructor', 'toString', 42, { x: 1 }]) {
        const r = await join({ lobby_id });
        assert.equal(r.event, 'fatal-error', `lobby_id ${JSON.stringify(lobby_id)}`);
        assert.equal(r.data.status, 'lobby_not_found');
    }

    const { body } = await createLobby();
    for (const player_token of ['__proto__', 'constructor', 'hasOwnProperty', 7]) {
        const r = await join({ lobby_id: body.lobby_id, player_token });
        assert.equal(r.event, 'fatal-error', `token ${JSON.stringify(player_token)}`);
        assert.equal(r.data.status, 'invalid_player_token');
    }
    assert.equal(Object.prototype.connected, undefined, 'Object.prototype untouched');

    // Still serving normal joins afterwards
    assert.equal((await join({ lobby_id: body.lobby_id })).event, 'joined');
});

test('validates location and player updates', { skip }, async () => {
    const { body } = await createLobby();
    const { socket } = await join({ lobby_id: body.lobby_id });

    assert.equal((await ack(socket, 'update-location', { latitude: 39.19, longitude: -96.58 })).status, 'success');
    for (const bad of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: '1', longitude: 2 },
        { latitude: NaN, longitude: 0 }, null, 'x']) {
        assert.equal((await ack(socket, 'update-location', bad)).status, 'validation_error', JSON.stringify(bad));
    }

    const renamed = await ack(socket, 'update-player', { name: `  ${'x'.repeat(50)}  ` });
    assert.equal(renamed.player_data.name.length, 30);
    assert.equal((await ack(socket, 'update-player', { is_seeker: true })).player_data.is_seeker, true);
    assert.equal((await ack(socket, 'update-player', { name: '   ' })).status, 'validation_error');
    assert.equal((await ack(socket, 'update-player', { is_seeker: 'yes' })).status, 'validation_error');
});

test('broadcasts lobby state to everyone, coalescing bursts', { skip }, async () => {
    const { body } = await createLobby();
    const a = await join({ lobby_id: body.lobby_id });
    const b = await join({ lobby_id: body.lobby_id });

    const states = [];
    a.socket.on('lobby-state', (s) => states.push(s));
    await ack(b.socket, 'update-player', { name: 'Ben' });
    await new Promise((r) => setTimeout(r, 100));

    const last = states.at(-1);
    assert.ok(last, 'received a lobby-state');
    assert.deepEqual(last.players.map((p) => p.name).sort(), ['Ben', 'Player 1']);
});

test('caps players per lobby', { skip }, async () => {
    const { body } = await createLobby();
    for (let i = 0; i < 3; i++) assert.equal((await join({ lobby_id: body.lobby_id })).event, 'joined');
    const fourth = await join({ lobby_id: body.lobby_id });
    assert.equal(fourth.event, 'fatal-error');
    assert.equal(fourth.data.status, 'lobby_full');
});

test('leaving removes the player, and the last one out removes the lobby', { skip }, async () => {
    const { body } = await createLobby();
    const a = await join({ lobby_id: body.lobby_id });
    const b = await join({ lobby_id: body.lobby_id });

    assert.equal((await ack(a.socket, 'leave-lobby', {})).status, 'success');
    assert.equal(game.lobbies.get(body.lobby_id).players.size, 1);

    // A stale token is not resumable after leaving
    const resumed = await join({ lobby_id: body.lobby_id, player_token: a.data.player_token });
    assert.equal(resumed.data.status, 'invalid_player_token');

    await ack(b.socket, 'leave-lobby', {});
    assert.equal(game.lobbies.has(body.lobby_id), false);
});

test('cleanup expires disconnected players and abandoned lobbies', { skip }, async () => {
    const { body } = await createLobby();
    const a = await join({ lobby_id: body.lobby_id });
    a.socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));

    const lobby = game.lobbies.get(body.lobby_id);
    lobby.players.get(a.data.player_token).disconnected_at = 0; // long ago
    lobby.created_at = 0;
    game.cleanupExpired();
    assert.equal(game.lobbies.has(body.lobby_id), false);

    const { body: empty } = await createLobby();
    game.lobbies.get(empty.lobby_id).created_at = 0;
    game.cleanupExpired();
    assert.equal(game.lobbies.has(empty.lobby_id), false, 'never-joined lobby removed');
});

// ---------- Host authority, phases, settings, avatars ----------

async function hostedLobby() {
    const { body } = await createLobby('Hosted');
    const host = await join({ lobby_id: body.lobby_id, host_key: body.host_key });
    return { lobbyId: body.lobby_id, hostKey: body.host_key, host };
}

test('the creator\'s host key makes them host; others cannot use host actions', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    assert.equal(me(host).is_host, true);
    assert.equal(host.data.state.host_id, host.data.player_id);

    const guest = await join({ lobby_id: lobbyId });
    assert.equal(me(guest).is_host, false);
    for (const [event, payload] of [['update-settings', { settings: { time_limit_s: 60 } }], ['start-game', {}],
        ['kick-player', { player_id: host.data.player_id }], ['set-role', { player_id: 1, is_seeker: true }],
        ['transfer-host', { player_id: guest.data.player_id }], ['end-game', {}], ['reset-game', {}]]) {
        assert.equal((await ack(guest.socket, event, payload)).status, 'forbidden', event);
    }
    // A wrong key grants nothing
    const imposter = await join({ lobby_id: lobbyId, host_key: 'not-the-key' });
    assert.equal(me(imposter).is_host, false);
});

test('a lobby with no host gives it to the first player; the key reclaims it', { skip }, async () => {
    const { body } = await createLobby();
    const first = await join({ lobby_id: body.lobby_id });
    assert.equal(me(first).is_host, true, 'nobody used the key, so the first player hosts');
    const creator = await join({ lobby_id: body.lobby_id, host_key: body.host_key });
    assert.equal(me(creator).is_host, true, 'creator reclaims with the key');
});

test('host settings are validated and only change before the game', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const square = [
        { latitude: 39.191, longitude: -96.581 }, { latitude: 39.191, longitude: -96.579 },
        { latitude: 39.189, longitude: -96.579 }, { latitude: 39.189, longitude: -96.581 },
    ];
    const ok = await ack(host.socket, 'update-settings', {
        settings: { geofence: { points: square.map((p) => ({ ...p, junk: 'dropped' })) }, time_limit_s: 1800, head_start_s: 60 }
    });
    assert.equal(ok.status, 'success');
    assert.deepEqual(ok.settings, { geofence: { points: square }, time_limit_s: 1800, head_start_s: 60 }, 'only coordinates are kept');

    const bowtie = [square[0], square[2], square[1], square[3]];
    for (const bad of [{ geofence: { points: square.slice(0, 2) } }, { geofence: { points: bowtie } },
        { geofence: { points: [...square.slice(0, 3), { latitude: 99, longitude: 0 }] } },
        { geofence: { points: Array.from({ length: 31 }, (_, i) => ({ latitude: 39 + Math.cos(i) / 100, longitude: -96 + Math.sin(i) / 100 })) } },
        { geofence: { points: [square[0], square[1], { latitude: 40.5, longitude: -96.58 }] } },
        { time_limit_s: -1 }, { time_limit_s: 1.5 }, { head_start_s: 9999 }, { geofence: 'x' }, { geofence: { points: 'x' } }]) {
        assert.equal((await ack(host.socket, 'update-settings', { settings: bad })).status, 'validation_error', JSON.stringify(bad));
    }
    assert.equal(game.lobbies.get(lobbyId).settings.time_limit_s, 1800, 'bad updates change nothing');

    // Partial update keeps the rest
    await ack(host.socket, 'update-settings', { settings: { geofence: null } });
    assert.deepEqual(game.lobbies.get(lobbyId).settings, { geofence: null, time_limit_s: 1800, head_start_s: 60 });
});

test('starting needs both roles, then locks self role changes', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const guest = await join({ lobby_id: lobbyId });
    assert.equal((await ack(host.socket, 'start-game')).status, 'need_both_roles');

    await ack(host.socket, 'update-player', { is_seeker: true });
    assert.equal((await ack(host.socket, 'start-game')).status, 'success');
    assert.equal(game.lobbies.get(lobbyId).phase, 'playing');

    assert.equal((await ack(guest.socket, 'update-player', { is_seeker: true })).status, 'role_locked');
    assert.equal((await ack(guest.socket, 'update-player', { name: 'Still fine' })).status, 'success', 'names can change');
    // The host can still move people (a caught hider joins the seekers)
    assert.equal((await ack(host.socket, 'set-role', { player_id: guest.data.player_id, is_seeker: true })).status, 'success');
    assert.equal(game.lobbies.get(lobbyId).players.get(guest.data.player_token).is_seeker, true);
    assert.equal((await ack(host.socket, 'update-settings', { settings: { time_limit_s: 60 } })).status, 'wrong_phase');
});

test('positions are hidden before the game and hiders stay hidden during the head start', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const hider = await join({ lobby_id: lobbyId });
    await ack(host.socket, 'update-player', { is_seeker: true });
    await ack(hider.socket, 'update-location', { latitude: 39.19, longitude: -96.58 });
    await ack(host.socket, 'update-location', { latitude: 39.2, longitude: -96.58 });

    assert.ok(game.lobbies.get(lobbyId).players.get(hider.data.player_token).latitude, 'server stores the position');
    // Force a fresh push, then check nobody's position is in it
    const pregameState = nextState(host.socket, (s) => s.players.some((p) => p.name === 'Pregame'));
    await ack(hider.socket, 'update-player', { name: 'Pregame' });
    assert.ok((await pregameState).players.every((p) => p.latitude === null && p.longitude === null), 'no positions shared pregame');

    await ack(host.socket, 'update-settings', { settings: { head_start_s: 1 } });
    await ack(host.socket, 'start-game');
    const during = await nextState(host.socket, (s) => s.phase === 'playing');
    const hiderDuring = during.players.find((p) => p.player_id === hider.data.player_id);
    const seekerDuring = during.players.find((p) => p.player_id === host.data.player_id);
    assert.equal(hiderDuring.latitude, null, 'hider hidden during head start');
    assert.equal(seekerDuring.latitude, 39.2, 'seekers are visible to hiders');

    const after = await nextState(host.socket, (s) => s.players.find((p) => p.player_id === hider.data.player_id).latitude !== null, 3000);
    assert.equal(after.players.find((p) => p.player_id === hider.data.player_id).latitude, 39.19, 'revealed after head start');
});

test('the time limit ends the game for the hiders; the host can end and reset', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    await join({ lobby_id: lobbyId });
    await ack(host.socket, 'update-player', { is_seeker: true });
    await ack(host.socket, 'update-settings', { settings: { time_limit_s: 1 } });
    await ack(host.socket, 'start-game');
    const ended = await nextState(host.socket, (s) => s.phase === 'ended', 4000);
    assert.deepEqual(ended.game.result, { reason: 'time_up', winner: 'hiders' });

    assert.equal((await ack(host.socket, 'reset-game')).status, 'success');
    assert.equal(game.lobbies.get(lobbyId).phase, 'lobby');
    assert.equal(game.lobbies.get(lobbyId).game, null);

    await ack(host.socket, 'update-settings', { settings: { time_limit_s: 0 } });
    await ack(host.socket, 'start-game');
    assert.equal((await ack(host.socket, 'end-game')).status, 'success');
    assert.equal(game.lobbies.get(lobbyId).game.result.reason, 'host_ended');
});

test('out-of-bounds is flagged against the play area during a game', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const runner = await join({ lobby_id: lobbyId });
    await ack(host.socket, 'update-player', { is_seeker: true });
    // ~220 m square around the host
    await ack(host.socket, 'update-settings', { settings: { geofence: { points: [
        { latitude: 39.191, longitude: -96.581 }, { latitude: 39.191, longitude: -96.579 },
        { latitude: 39.189, longitude: -96.579 }, { latitude: 39.189, longitude: -96.581 },
    ] } } });
    await ack(host.socket, 'update-location', { latitude: 39.19, longitude: -96.58 });
    await ack(runner.socket, 'update-location', { latitude: 39.2, longitude: -96.58 }); // ~1.1 km out
    await ack(host.socket, 'start-game');
    const state = await nextState(host.socket, (s) => s.phase === 'playing');
    assert.equal(state.players.find((p) => p.player_id === runner.data.player_id).out_of_bounds, true);
    assert.equal(state.players.find((p) => p.player_id === host.data.player_id).out_of_bounds, false);
});

test('the host can remove a player, who is told why', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const guest = await join({ lobby_id: lobbyId });
    const told = new Promise((resolve) => guest.socket.once('fatal-error', resolve));
    assert.equal((await ack(host.socket, 'kick-player', { player_id: host.data.player_id })).status, 'validation_error', 'not yourself');
    assert.equal((await ack(host.socket, 'kick-player', { player_id: guest.data.player_id })).status, 'success');
    assert.equal((await told).status, 'kicked');
    assert.equal(game.lobbies.get(lobbyId).players.has(guest.data.player_token), false);
    const back = await join({ lobby_id: lobbyId, player_token: guest.data.player_token });
    assert.equal(back.data.status, 'invalid_player_token', 'their old identity is gone');
});

test('the host role moves on when the host leaves or hands it over', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const second = await join({ lobby_id: lobbyId });
    const third = await join({ lobby_id: lobbyId });

    assert.equal((await ack(host.socket, 'transfer-host', { player_id: third.data.player_id })).status, 'success');
    const lobby = game.lobbies.get(lobbyId);
    assert.equal(lobby.host_token, third.data.player_token);
    assert.equal((await ack(host.socket, 'start-game')).status, 'forbidden', 'old host lost authority');

    await ack(third.socket, 'leave-lobby');
    assert.equal(lobby.host_token, host.data.player_token, 'earliest remaining player hosts');
    void second;
});

test('profile pictures are validated and delivered separately from state', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const watcher = await join({ lobby_id: lobbyId });
    const picture = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');

    const pushed = new Promise((resolve) => watcher.socket.once('avatar', resolve));
    assert.equal((await ack(host.socket, 'set-avatar', { avatar: picture })).status, 'success');
    assert.deepEqual(await pushed, { player_id: host.data.player_id, avatar: picture });

    for (const bad of ['http://evil/x.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,' + 'A'.repeat(50_000), 42]) {
        assert.equal((await ack(host.socket, 'set-avatar', { avatar: bad })).status, 'validation_error');
    }

    const state = await nextState(watcher.socket);
    assert.ok(!JSON.stringify(state).includes('base64'), 'pictures are not in the per-second state');
    assert.equal(state.players.find((p) => p.player_id === host.data.player_id).avatar_rev, 1);

    // A newcomer gets everyone's picture once, on join
    const late = connect(base, { path: SOCKET_PATH, auth: { lobby_id: lobbyId }, reconnection: false, transports: ['websocket'] });
    sockets.push(late);
    const avatars = await new Promise((resolve) => late.once('avatars', resolve));
    assert.equal(avatars.avatars[host.data.player_id], picture);

    assert.equal((await ack(host.socket, 'set-avatar', { avatar: null })).status, 'success', 'can be cleared');
});
