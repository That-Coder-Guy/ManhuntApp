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
    game = createGameServer({ distDir: null, broadcastIntervalMs: 20, maxPlayersPerLobby: 3 });
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

const ack = (socket, event, payload) => socket.timeout(2000).emitWithAck(event, payload);

test('creates a lobby and rejects a missing or malformed name', { skip }, async () => {
    const ok = await createLobby('  Riverside  ');
    assert.equal(ok.status, 200);
    assert.match(ok.body.lobby_id, /^[0-9a-f-]{36}$/);
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
    assert.equal(first.data.player_data.name, 'Player 1');

    first.socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    const player = game.lobbies.get(body.lobby_id).players.get(first.data.player_token);
    assert.equal(player.connected, false, 'disconnect keeps the player, marked offline');

    const again = await join({ lobby_id: body.lobby_id, player_token: first.data.player_token });
    assert.equal(again.event, 'joined');
    assert.equal(again.data.player_data.player_id, first.data.player_data.player_id);
    assert.equal(again.data.player_data.connected, true);
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
