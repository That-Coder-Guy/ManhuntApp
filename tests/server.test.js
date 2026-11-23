import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

// Stands in for the push services: records what would be sent. An endpoint
// containing "gone" answers like a subscription the browser dropped
const pushed = [];
const fakePush = {
    publicKey: 'test-public-key',
    async send(subscription, payload, options)
    {
        pushed.push({ endpoint: subscription.endpoint, payload, options });
        return subscription.endpoint.includes('gone') ? { gone: true } : { ok: true };
    }
};
const subscription = (name) => ({
    endpoint: `https://web.push.apple.com/${name}`,
    keys: { p256dh: 'BOr6Kb1oSpY4QpvxMk2cX0Va', auth: 'k7JmY2hLx3Q' }
});
const sockets = [];

before(async () => {
    if (skip) return;
    game = createGameServer({ distDir: null, broadcastIntervalMs: 20, blurRecheckMs: 100, maxPlayersPerLobby: 3, cleanupIntervalMs: 60_000, push: fakePush });
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
    assert.deepEqual(ok.settings, { geofence: { points: square }, time_limit_s: 1800, head_start_s: 60, found_range_m: 50, seeker_info: 'distance', seeker_alert_m: 100, jam_enabled: true, jam_duration_s: 60, jam_charge_s: 900, hider_blur_m: 25 }, 'only coordinates are kept');

    const bowtie = [square[0], square[2], square[1], square[3]];
    for (const bad of [{ geofence: { points: square.slice(0, 2) } }, { geofence: { points: bowtie } },
        { geofence: { points: [...square.slice(0, 3), { latitude: 99, longitude: 0 }] } },
        { geofence: { points: Array.from({ length: 31 }, (_, i) => ({ latitude: 39 + Math.cos(i) / 100, longitude: -96 + Math.sin(i) / 100 })) } },
        { geofence: { points: [square[0], square[1], { latitude: 40.5, longitude: -96.58 }] } },
        { time_limit_s: -1 }, { time_limit_s: 1.5 }, { head_start_s: 9999 }, { geofence: 'x' }, { geofence: { points: 'x' } },
        { found_range_m: 9 }, { found_range_m: 501 }, { found_range_m: 50.5 }, { found_range_m: '50' },
        { seeker_info: 'exact' }, { seeker_info: null }, { seeker_alert_m: 9 }, { seeker_alert_m: 1001 }, { seeker_alert_m: 99.5 },
        { jam_enabled: 'off' }, { jam_duration_s: 5 }, { jam_duration_s: 601 }, { jam_charge_s: 5 }, { jam_charge_s: 3601 },
        { hider_blur_m: 10 }, { hider_blur_m: 501 }, { hider_blur_m: 50.5 }]) {
        assert.equal((await ack(host.socket, 'update-settings', { settings: bad })).status, 'validation_error', JSON.stringify(bad));
    }
    assert.equal(game.lobbies.get(lobbyId).settings.time_limit_s, 1800, 'bad updates change nothing');

    // Partial update keeps the rest
    await ack(host.socket, 'update-settings', { settings: { geofence: null, found_range_m: 100, seeker_info: 'nearby', seeker_alert_m: 250, jam_duration_s: 30 } });
    // (the alert was asked for at 250 m: where an alert is all hiders get, it is brought down to the found range)
    assert.deepEqual(game.lobbies.get(lobbyId).settings, { geofence: null, time_limit_s: 1800, head_start_s: 60, found_range_m: 100, seeker_info: 'nearby', seeker_alert_m: 100, jam_enabled: true, jam_duration_s: 30, jam_charge_s: 900, hider_blur_m: 25 });
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

    // (exact positions: this is about when they show, not how exactly)
    await ack(host.socket, 'update-settings', { settings: { head_start_s: 1, hider_blur_m: 0 } });
    await ack(host.socket, 'start-game');
    const during = await nextState(host.socket, (s) => s.phase === 'playing');
    const hiderDuring = during.players.find((p) => p.player_id === hider.data.player_id);
    const seekerDuring = during.players.find((p) => p.player_id === host.data.player_id);
    assert.equal(hiderDuring.latitude, null, 'hider hidden during head start');
    assert.equal(seekerDuring.latitude, 39.2, 'seekers see each other');

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

// ~33 m and ~220 m north of a seeker standing at SEEKER
const SEEKER = { latitude: 39.19, longitude: -96.58 };
const NEAR = { latitude: 39.1903, longitude: -96.58 };
const FAR = { latitude: 39.192, longitude: -96.58 };

// A host seeker at SEEKER and two hiders, the game running with no head start
async function foundGame() {
    const { lobbyId, host } = await hostedLobby();
    const near = await join({ lobby_id: lobbyId });
    const far = await join({ lobby_id: lobbyId });
    await ack(host.socket, 'update-player', { is_seeker: true });
    // Seekers get exact positions in these games: the tests that use them are
    // about finding, seeker info and jamming, not about how exactly hiders show
    await ack(host.socket, 'update-settings', { settings: { hider_blur_m: 0 } });
    await ack(host.socket, 'update-location', SEEKER);
    await ack(near.socket, 'update-location', NEAR);
    await ack(far.socket, 'update-location', FAR);
    return { lobbyId, host, near, far };
}

// The next state a hider gets once the game is on
const hiderState = (socket) => nextState(socket, (s) => s.phase === 'playing' && s.seeker_info);

test('hiders never receive a seeker\'s position during a game, only the seeker info the host allows; of each other, what the seekers get', { skip }, async () => {
    const { lobbyId, host, near, far } = await foundGame();
    const nearState = hiderState(near.socket);
    const hostState = nextState(host.socket, (s) => s.phase === 'playing');
    await ack(host.socket, 'start-game');

    const seen = await nearState;
    const seekers = seen.players.filter((p) => p.is_seeker);
    assert.ok(seekers.length === 1 && seekers.every((p) => p.latitude === null && p.longitude === null), 'no seeker\'s position reaches a hider');
    assert.equal(seen.players.find((p) => p.player_id === near.data.player_id).latitude, NEAR.latitude, 'their own is still there');
    const fellow = seen.players.find((p) => p.player_id === far.data.player_id);
    // (this lobby is set to exact positions, so what the seekers get is the real one)
    assert.deepEqual([fellow.latitude, fellow.longitude, fellow.is_seeker], [FAR.latitude, FAR.longitude, false], 'and their fellow hider\'s, as the seekers have it');
    assert.deepEqual(seen.seeker_info, { mode: 'distance', distance_m: 33 }, 'the default: metres to the nearest seeker');

    const seekerSees = await hostState;
    assert.equal(seekerSees.seeker_info, undefined, 'seekers get no seeker info');
    assert.equal(seekerSees.players.find((p) => p.player_id === far.data.player_id).latitude, FAR.latitude, 'seekers still see the hiders');

    // A rejoining hider's first state is filtered too
    near.socket.disconnect();
    const back = await join({ lobby_id: lobbyId, player_token: near.data.player_token });
    assert.ok(back.data.state.players.filter((p) => p.is_seeker).every((p) => p.latitude === null));
    assert.equal(back.data.state.seeker_info.mode, 'distance');
});

test('the nearby alert says only whether a seeker is within the alert distance', { skip }, async () => {
    const { host, near, far } = await foundGame();
    // Asked for at 100 m, with the found range at 50: the alert can't reach further than that
    const saved = await ack(host.socket, 'update-settings', { settings: { seeker_info: 'nearby', seeker_alert_m: 100 } });
    assert.deepEqual([saved.status, saved.settings.seeker_alert_m, saved.settings.found_range_m], ['success', 50, 50]);
    const nearState = hiderState(near.socket);
    const farState = hiderState(far.socket);
    await ack(host.socket, 'start-game');
    assert.deepEqual((await nearState).seeker_info, { mode: 'nearby', alert_m: 50, nearby: true }, '33 m away');
    assert.deepEqual((await farState).seeker_info, { mode: 'nearby', alert_m: 50, nearby: false }, '222 m away');

    // The seeker closes in. At 55 m, inside the 100 m that was asked for, nothing yet
    await ack(host.socket, 'update-location', { latitude: 39.1915, longitude: -96.58 });
    const stillClear = await nextState(far.socket, (s) => s.seeker_info?.mode === 'nearby');
    assert.equal(stillClear.seeker_info.nearby, false, '55 m: outside the found range, so no alert');
    // At 33 m the far hider is alerted, and could be found
    const alerted = nextState(far.socket, (s) => s.seeker_info?.nearby === true);
    await ack(host.socket, 'update-location', { latitude: 39.1917, longitude: -96.58 });
    assert.ok(await alerted);
});

test('with seeker info off, hiders learn nothing about the seekers', { skip }, async () => {
    const { host, near } = await foundGame();
    await ack(host.socket, 'update-settings', { settings: { seeker_info: 'none' } });
    const nearState = hiderState(near.socket);
    await ack(host.socket, 'start-game');
    const seen = await nearState;
    assert.deepEqual(seen.seeker_info, { mode: 'none' });
    assert.ok(seen.players.filter((p) => p.is_seeker).every((p) => p.latitude === null));
    // Finding still works: the server checks the distance itself
    assert.equal((await ack(near.socket, 'found', NEAR)).status, 'success');
});

test('a hider within the found range of a seeker can declare themselves found', { skip }, async () => {
    const { lobbyId, host, near, far } = await foundGame();
    assert.equal((await ack(near.socket, 'found', NEAR)).status, 'wrong_phase', 'not before the game');
    await ack(host.socket, 'start-game');

    assert.equal((await ack(host.socket, 'found', SEEKER)).status, 'already_seeker');
    const tooFar = await ack(far.socket, 'found', FAR);
    assert.equal(tooFar.status, 'too_far');
    assert.match(tooFar.description, /50 m/);

    const told = new Promise((resolve) => host.socket.once('player-found', resolve));
    assert.equal((await ack(near.socket, 'found', NEAR)).status, 'success');
    assert.deepEqual(await told, { player_id: near.data.player_id, name: game.lobbies.get(lobbyId).players.get(near.data.player_token).name, hiders_left: 1 });
    const lobby = game.lobbies.get(lobbyId);
    assert.equal(lobby.players.get(near.data.player_token).is_seeker, true, 'the found hider joins the seekers');
    assert.equal(lobby.phase, 'playing', 'one hider is still out');
    assert.deepEqual(lobby.game.found.map((f) => f.player_id), [near.data.player_id]);
});

test('the last hider found ends the game, and the lobby restores the starting roles', { skip }, async () => {
    const { lobbyId, host, near, far } = await foundGame();
    await ack(host.socket, 'start-game');
    await ack(near.socket, 'found', NEAR);
    // The phone's own position comes with the request: walking up counts
    const ended = nextState(host.socket, (s) => s.phase === 'ended');
    assert.equal((await ack(far.socket, 'found', NEAR)).status, 'success');
    const state = await ended;
    assert.deepEqual(state.game.result, { reason: 'all_found', winner: 'seekers' });
    assert.deepEqual(state.game.found.map((f) => f.player_id), [near.data.player_id, far.data.player_id]);

    // The results stay until the host takes everyone back
    assert.equal((await ack(near.socket, 'reset-game')).status, 'forbidden', 'only the host');
    assert.equal(game.lobbies.get(lobbyId).phase, 'ended');
    assert.equal((await ack(host.socket, 'reset-game')).status, 'success');
    const players = game.lobbies.get(lobbyId).players;
    assert.equal(players.get(near.data.player_token).is_seeker, false, 'back to hider');
    assert.equal(players.get(far.data.player_token).is_seeker, false, 'back to hider');
    assert.equal(players.get(host.data.player_token).is_seeker, true, 'the seeker stays one');
});

test('finding waits out the head start and needs a recent seeker fix', { skip }, async () => {
    const { lobbyId, host, near } = await foundGame();
    await ack(host.socket, 'update-settings', { settings: { head_start_s: 60 } });
    await ack(host.socket, 'start-game');
    assert.equal((await ack(near.socket, 'found', NEAR)).status, 'head_start');

    const lobby = game.lobbies.get(lobbyId);
    lobby.game.head_start_ends_at = Date.now() - 1;
    lobby.players.get(host.data.player_token).location_last_updated = Date.now() - 3 * 60 * 1000;
    assert.equal((await ack(near.socket, 'found', NEAR)).status, 'too_far', "a seeker's stale fix doesn't count");
    await ack(host.socket, 'update-location', SEEKER);
    assert.equal((await ack(near.socket, 'found', NEAR)).status, 'success');
});

test('the host can widen the found range', { skip }, async () => {
    const { host, far } = await foundGame();
    await ack(host.socket, 'update-settings', { settings: { found_range_m: 250 } });
    await ack(host.socket, 'start-game');
    assert.equal((await ack(far.socket, 'found', FAR)).status, 'success', '220 m counts within 250 m');
});

test('a game with no hiders left ends: moved by the host, or gone', { skip }, async () => {
    let { lobbyId, host, near, far } = await foundGame();
    await ack(host.socket, 'start-game');
    await ack(host.socket, 'set-role', { player_id: near.data.player_id, is_seeker: true });
    await ack(host.socket, 'set-role', { player_id: far.data.player_id, is_seeker: true });
    assert.deepEqual(game.lobbies.get(lobbyId).game.result, { reason: 'all_found', winner: 'seekers' });

    ({ lobbyId, host, near, far } = await foundGame());
    await ack(host.socket, 'start-game');
    await ack(near.socket, 'found', NEAR);
    await ack(far.socket, 'leave-lobby');
    assert.equal(game.lobbies.get(lobbyId).phase, 'ended');
    assert.deepEqual(game.lobbies.get(lobbyId).game.result, { reason: 'no_hiders', winner: null });
});

// ---- Jamming ----

const entry = (state, joined) => state.players.find((p) => p.player_id === joined.data.player_id);

test('a hider jams: they vanish for the seekers, who then get the real position back', { skip }, async () => {
    const { lobbyId, host, near, far } = await foundGame();
    const lobby = game.lobbies.get(lobbyId);
    const firstHiderState = hiderState(near.socket);
    await ack(host.socket, 'start-game');
    const maya = lobby.players.get(near.data.player_token);

    // Uncharged at the start: fifteen minutes from the seekers' release
    const start = await firstHiderState;
    assert.equal(start.jam.state, 'charging');
    assert.equal(start.jam.ready_at, start.game.head_start_ends_at + 15 * 60 * 1000);
    assert.equal((await ack(near.socket, 'jam')).status, 'charging');
    assert.equal((await ack(host.socket, 'jam')).status, 'not_a_hider');

    // Charged. (A second-long jam, shorter than a host can set, keeps this quick)
    maya.jam_ready_at = Date.now() - 1;
    lobby.settings.jam_duration_s = 1;
    const told = new Promise((resolve) => host.socket.once('player-jammed', resolve));
    const started = await ack(near.socket, 'jam');
    assert.equal(started.status, 'success');
    assert.equal(started.jam.state, 'active');
    assert.deepEqual({ id: (await told).player_id, until: (await told).until }, { id: near.data.player_id, until: started.jam.until }, 'everyone is told who');
    assert.equal((await ack(near.socket, 'jam')).status, 'already_jamming');

    // Maya runs. Priya moving too is what brings the seeker a fresh state
    const MAYA_MOVED = { latitude: 39.195, longitude: -96.58 };
    const PRIYA_MOVED = { latitude: 39.1921, longitude: -96.58 };
    await ack(near.socket, 'update-location', MAYA_MOVED);
    const seekerSees = nextState(host.socket, (s) => entry(s, far).latitude === PRIYA_MOVED.latitude);
    const mayaSees = nextState(near.socket, (s) => s.jam?.state === 'active' && entry(s, near).latitude === MAYA_MOVED.latitude);
    await ack(far.socket, 'update-location', PRIYA_MOVED);

    const during = await seekerSees;
    const gone = entry(during, near);
    assert.deepEqual([gone.latitude, gone.longitude, gone.location_last_updated, gone.uncertainty_m, gone.out_of_bounds], [null, null, null, null, false],
        'the seeker has nothing of where Maya is, or was');
    assert.equal(gone.jammed_until, started.jam.until, 'only that she is jamming, and until when');
    assert.ok(!JSON.stringify(during).includes(String(NEAR.latitude)) && !JSON.stringify(during).includes(String(MAYA_MOVED.latitude)), 'neither position is anywhere in what the seeker was sent');
    assert.equal(entry(during, far).jammed_until, null, 'Priya is tracked as ever');
    assert.equal(entry(during, far).latitude, PRIYA_MOVED.latitude);
    assert.equal(entry(await mayaSees, near).jammed_until, started.jam.until, 'Maya\'s own phone keeps her real position');

    // It runs out by itself: the seeker gets her real position without her doing anything
    const after = await nextState(host.socket, (s) => entry(s, near).jammed_until === null, 4000);
    assert.equal(entry(after, near).latitude, MAYA_MOVED.latitude);
    // And it has to charge again, for the whole charge time from the end of the jam
    assert.equal((await ack(near.socket, 'jam')).status, 'charging');
    assert.equal(maya.jam_ready_at, maya.jam_until + 15 * 60 * 1000);
});

test('jamming can be turned off, ends when a hider is found, and starts over for a new hider', { skip }, async () => {
    // Off: no jammer in a hider's state, and the server refuses
    const off = await foundGame();
    assert.equal((await ack(off.host.socket, 'update-settings', { settings: { jam_enabled: false } })).status, 'success');
    const offState = hiderState(off.near.socket);
    assert.equal((await ack(off.near.socket, 'jam')).status, 'wrong_phase', 'nothing to jam before the game');
    await ack(off.host.socket, 'start-game');
    assert.deepEqual((await offState).jam, { enabled: false });
    assert.equal((await ack(off.near.socket, 'jam')).status, 'jam_off');

    // On: a hider who is found mid-jam is a seeker with no jam left
    const { lobbyId, host, near, far } = await foundGame();
    const lobby = game.lobbies.get(lobbyId);
    await ack(host.socket, 'start-game');
    const maya = lobby.players.get(near.data.player_token);
    maya.jam_ready_at = Date.now() - 1;
    assert.equal((await ack(near.socket, 'jam')).status, 'success');
    const found = nextState(host.socket, (s) => entry(s, near).is_seeker);
    assert.equal((await ack(near.socket, 'found', NEAR)).status, 'success');
    assert.equal(entry(await found, near).jammed_until, null);
    assert.equal(maya.jam_until, undefined);

    // The host makes her a hider again: her jammer charges from now
    const before = Date.now();
    await ack(host.socket, 'set-role', { player_id: near.data.player_id, is_seeker: false });
    assert.ok(maya.jam_ready_at >= before + 15 * 60 * 1000 && maya.jam_until === undefined);
    // Back to the lobby wipes every jammer
    await ack(host.socket, 'end-game');
    await ack(host.socket, 'reset-game');
    assert.ok([...lobby.players.values()].every((p) => p.jam_ready_at === undefined && p.jam_until === undefined));
    assert.equal(lobby.jamTimers.size, 0);
    far.socket.disconnect();
});

// ---- How exactly seekers see a hider ----

const { distanceMeters } = require('../server/game.js');

test('a still hider is shown as an area, a moving one exactly, and a stopped one as an area again', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const hider = await join({ lobby_id: lobbyId });
    const lobby = game.lobbies.get(lobbyId);
    const maya = lobby.players.get(hider.data.player_token);
    await ack(host.socket, 'update-player', { is_seeker: true });
    await ack(host.socket, 'update-location', SEEKER);
    await ack(hider.socket, 'update-location', NEAR);
    const first = nextState(host.socket, (s) => s.phase === 'playing' && entry(s, hider).latitude !== null);
    const own = nextState(hider.socket, (s) => s.phase === 'playing');
    await ack(host.socket, 'start-game');

    // Standing still: the seeker gets a point that isn't hers, and how far off she may be
    const still = entry(await first, hider);
    assert.equal(still.uncertainty_m, 25);
    const off = distanceMeters(still, NEAR);
    assert.ok(off > 0.01 && off <= 25, `a point within 25 m of her, not her own: ${off}`);
    // Her own phone has her real position, and is told how she is seen
    assert.deepEqual([entry(await own, hider).latitude, entry(await own, hider).uncertainty_m], [NEAR.latitude, 25]);

    // Her position wobbles a couple of metres: the seeker's point doesn't move
    // (less than the margin a new circle is put down with, so she can't have left it)
    for (const wobble of [0.00001, -0.000015, 0.000005, 0.00002]) {
        const next = nextState(host.socket, (s) => s.server_time > still.location_last_updated);
        await ack(hider.socket, 'update-location', { latitude: NEAR.latitude + wobble, longitude: NEAR.longitude - wobble });
        const seen = entry(await next, hider);
        assert.deepEqual([seen.latitude, seen.longitude, seen.uncertainty_m], [still.latitude, still.longitude, 25]);
    }

    // She has been running north at 3 m/s for the last minute (what her phone would have sent):
    // faster than an 11-minute mile
    const walked = (secondsAgo) => ({ latitude: NEAR.latitude + ((60 - secondsAgo) * 3) / 111_195, longitude: NEAR.longitude });
    const now = Date.now();
    maya.fixes = [60, 50, 40, 30, 20, 10].map((ago) => ({ ...walked(ago), at: now - ago * 1000 }));
    const moving = nextState(host.socket, (s) => entry(s, hider).uncertainty_m === 0);
    await ack(hider.socket, 'update-location', walked(0));
    assert.deepEqual([entry(await moving, hider).latitude, entry(await moving, hider).longitude], [walked(0).latitude, walked(0).longitude], 'exact while she runs');

    // She stopped there eleven seconds ago, and her phone has sent nothing
    // since (a phone standing still may not). Nobody else does anything
    // either: the server looks again by itself, and she is an area again
    const later = Date.now();
    maya.fixes = [60, 50, 40, 30, 20, 11].map((ago) => ({ ...walked(ago - 11), at: later - ago * 1000 }));
    const stopped = entry(await nextState(host.socket, (s) => entry(s, hider).uncertainty_m === 25), hider);
    assert.ok(distanceMeters(stopped, walked(0)) <= 25);
    assert.notEqual(stopped.latitude, walked(0).latitude);
    // And once she is, the server stops looking
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(lobby.blurTimer, null);

    // Finding is unaffected: it goes by her real position
    await ack(hider.socket, 'update-location', NEAR);
    assert.equal((await ack(hider.socket, 'found', NEAR)).status, 'success');
});

test('a jam hides even the vague position, and exact mode is still exact', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const hider = await join({ lobby_id: lobbyId });
    const lobby = game.lobbies.get(lobbyId);
    const maya = lobby.players.get(hider.data.player_token);
    await ack(host.socket, 'update-player', { is_seeker: true });
    await ack(host.socket, 'update-location', SEEKER);
    await ack(hider.socket, 'update-location', NEAR);
    const first = nextState(host.socket, (s) => s.phase === 'playing' && entry(s, hider).latitude !== null);
    await ack(host.socket, 'start-game');
    const still = entry(await first, hider);

    // She jams and runs 500 m: the seeker loses the area she was in, too
    assert.equal(still.uncertainty_m, 25);
    maya.jam_ready_at = Date.now() - 1;
    assert.equal((await ack(hider.socket, 'jam')).status, 'success');
    const during = nextState(host.socket, (s) => entry(s, hider).jammed_until !== null);
    await ack(hider.socket, 'update-location', { latitude: NEAR.latitude + 0.0045, longitude: NEAR.longitude });
    const jammed = entry(await during, hider);
    assert.deepEqual([jammed.latitude, jammed.longitude, jammed.uncertainty_m], [null, null, null]);

    // A lobby set to exact gives the real position, standing still or not
    const exact = await foundGame();
    const exactState = nextState(exact.host.socket, (s) => s.phase === 'playing' && entry(s, exact.near).latitude !== null);
    await ack(exact.host.socket, 'start-game');
    assert.deepEqual([entry(await exactState, exact.near).latitude, entry(await exactState, exact.near).uncertainty_m], [NEAR.latitude, 0]);
});

test('hiders see each other as the seekers see them, and no better', { skip }, async () => {
    // A lobby at the defaults: a still hider is an area to the seekers. With a head start
    const { lobbyId, host } = await hostedLobby();
    const maya = await join({ lobby_id: lobbyId });
    const priya = await join({ lobby_id: lobbyId });
    const lobby = game.lobbies.get(lobbyId);
    await ack(host.socket, 'update-player', { is_seeker: true });
    await ack(host.socket, 'update-settings', { settings: { head_start_s: 1 } });
    await ack(host.socket, 'update-location', SEEKER);
    await ack(maya.socket, 'update-location', NEAR);
    await ack(priya.socket, 'update-location', FAR);
    const early = nextState(maya.socket, (s) => s.phase === 'playing');
    await ack(host.socket, 'start-game');
    const where = (state) => { const p = entry(state, priya); return [p.latitude, p.longitude, p.uncertainty_m, p.jammed_until]; };

    // During the head start hiders are hidden, from each other as from the seekers
    assert.equal(entry(await early, priya).latitude, null);
    assert.equal(entry(await early, maya).latitude, NEAR.latitude, 'her own position is always hers');

    // After it: Maya has for Priya the very point and radius the seeker has, not Priya's position
    const seekerLater = nextState(host.socket, (s) => entry(s, priya).latitude !== null, 3000);
    const mayaLater = nextState(maya.socket, (s) => entry(s, priya).latitude !== null, 3000);
    assert.deepEqual(where(await mayaLater), where(await seekerLater));
    assert.equal(entry(await mayaLater, priya).uncertainty_m, 25);
    assert.notEqual(entry(await mayaLater, priya).latitude, FAR.latitude);
    assert.ok((await mayaLater).players.filter((p) => p.is_seeker).every((p) => p.latitude === null), 'and still no seeker');

    // Priya jams and runs: gone for Maya exactly as for the seeker
    lobby.players.get(priya.data.player_token).jam_ready_at = Date.now() - 1;
    assert.equal((await ack(priya.socket, 'jam')).status, 'success');
    const after = (s) => entry(s, priya).jammed_until !== null;
    const mayaSees = nextState(maya.socket, after);
    const seekerSees = nextState(host.socket, after);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await ack(priya.socket, 'update-location', { latitude: 39.196, longitude: -96.58 });
    assert.deepEqual(where(await mayaSees), where(await seekerSees));
    assert.deepEqual(where(await mayaSees).slice(0, 3), [null, null, null], 'no position, for a fellow hider either');

    // So when Maya is found and joins the seekers, she has learned nothing they didn't have
    const asSeeker = nextState(maya.socket, (s) => entry(s, maya).is_seeker);
    await ack(maya.socket, 'found', NEAR);
    assert.deepEqual(where(await asSeeker).slice(0, 3), where(await seekerSees).slice(0, 3));
    assert.equal((await asSeeker).jam, undefined);
});

// ---- Chat ----

test('everyone in the lobby shares one chat, and a newcomer gets what was said', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const maya = await join({ lobby_id: lobbyId });
    await ack(host.socket, 'update-player', { name: 'Hank', is_seeker: true });
    await ack(maya.socket, 'update-player', { name: 'Maya' });
    const heard = (socket) => new Promise((resolve) => socket.once('chat-message', resolve));

    // Hank writes: both get it, himself included, with who and when
    const [toHank, toMaya] = [heard(host.socket), heard(maya.socket)];
    const sent = await ack(host.socket, 'chat-send', { text: '  Ready when you are\n ' });
    assert.equal(sent.status, 'success');
    assert.deepEqual(await toMaya, await toHank);
    const first = await toMaya;
    assert.deepEqual([first.id, first.player_id, first.name, first.text], [1, host.data.player_id, 'Hank', 'Ready when you are']);
    assert.ok(Math.abs(first.at - Date.now()) < 2000);

    // It goes on during a game, across the two sides
    await ack(host.socket, 'start-game');
    const reply = heard(host.socket);
    assert.equal((await ack(maya.socket, 'chat-send', { text: 'You won\'t find me' })).status, 'success');
    assert.deepEqual([(await reply).id, (await reply).name], [2, 'Maya']);

    // Someone joining late, or coming back, is sent the conversation so far
    const late = connect(base, { path: SOCKET_PATH, auth: { lobby_id: lobbyId }, reconnection: false, transports: ['websocket'] });
    sockets.push(late);
    const history = await new Promise((resolve) => late.once('chat-history', resolve));
    assert.deepEqual(history.messages.map((m) => m.text), ['Ready when you are', 'You won\'t find me']);
    // A message keeps the name it was sent under, whatever its sender is called later
    await ack(host.socket, 'update-player', { name: 'Henry' });
    assert.equal(game.lobbies.get(lobbyId).chat[0].name, 'Hank');
});

test('chat messages are checked, and no one can flood the lobby', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    for (const bad of [{}, { text: '' }, { text: '   ' }, { text: 7 }, { text: 'x'.repeat(281) }, { text: null }]) {
        assert.equal((await ack(host.socket, 'chat-send', bad)).status, 'validation_error', JSON.stringify(bad).slice(0, 40));
    }
    assert.equal(game.lobbies.get(lobbyId).chat.length, 0, 'nothing refused is kept');

    // Five in a row go through; the sixth has to wait
    for (let i = 1; i <= 5; i++) assert.equal((await ack(host.socket, 'chat-send', { text: `message ${i}` })).status, 'success');
    assert.equal((await ack(host.socket, 'chat-send', { text: 'and another' })).status, 'too_fast');
    // (someone else isn't held up by it)
    const guest = await join({ lobby_id: lobbyId });
    assert.equal((await ack(guest.socket, 'chat-send', { text: 'hello' })).status, 'success');
    assert.equal(game.lobbies.get(lobbyId).chat.length, 6);

    // The lobby keeps the last 200, numbered on from where it was
    const lobby = game.lobbies.get(lobbyId);
    lobby.players.get(host.data.player_token).chat_times = [];
    lobby.chat = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, player_id: 1, name: 'Hank', text: `old ${i + 1}`, at: Date.now() }));
    lobby.next_message_id = 201;
    assert.equal((await ack(host.socket, 'chat-send', { text: 'newest' })).message.id, 201);
    assert.deepEqual([lobby.chat.length, lobby.chat[0].id, lobby.chat.at(-1).text], [200, 2, 'newest']);

    // Someone no longer in the lobby can't write to it
    await ack(host.socket, 'kick-player', { player_id: guest.data.player_id });
    assert.notEqual((await ack(guest.socket, 'chat-send', { text: 'still here?' }).catch(() => ({ status: 'gone' }))).status, 'success');
});

test('each side has a chat of its own, which the other side is never sent', { skip }, async () => {
    const { lobbyId, host, near: maya, far: priya } = await foundGame();
    const lobby = game.lobbies.get(lobbyId);
    // Everything each phone is ever sent of the chat
    const got = new Map([host, maya, priya].map((p) => [p, []]));
    for (const [p, list] of got) p.socket.on('chat-message', (m) => list.push(m.text));
    const settle = () => new Promise((resolve) => setTimeout(resolve, 120));
    const history = (socket) => new Promise((resolve) => socket.once('chat-history', (h) => resolve(h.messages.map((m) => m.text))));

    // A hider to the hiders: both hiders, not the seeker
    const sent = await ack(maya.socket, 'chat-send', { text: 'by the bins', channel: 'hiders' });
    assert.deepEqual([sent.status, sent.message.channel], ['success', 'hiders']);
    await ack(host.socket, 'chat-send', { text: 'closing in', channel: 'seekers' });
    await ack(priya.socket, 'chat-send', { text: 'hello all' });
    await settle();
    assert.deepEqual(got.get(maya), ['by the bins', 'hello all']);
    assert.deepEqual(got.get(priya), ['by the bins', 'hello all']);
    assert.deepEqual(got.get(host), ['closing in', 'hello all'], 'the seeker never gets the hiders\' message');
    assert.equal(lobby.chat.find((m) => m.text === 'hello all').channel, 'all');

    // Only a side's own players write to it, and only to a chat that exists
    assert.equal((await ack(host.socket, 'chat-send', { text: 'let me in', channel: 'hiders' })).status, 'wrong_side');
    assert.equal((await ack(maya.socket, 'chat-send', { text: 'let me in', channel: 'seekers' })).status, 'wrong_side');
    for (const channel of ['spies', '', 7, {}]) {
        assert.equal((await ack(maya.socket, 'chat-send', { text: 'hello', channel })).status, 'validation_error', JSON.stringify(channel));
    }
    assert.equal(lobby.chat.length, 3, 'nothing refused is kept');

    // Coming back (a reload, a dropped connection): the same chats as before
    const again = connect(base, { path: SOCKET_PATH, auth: { lobby_id: lobbyId, player_token: priya.data.player_token }, reconnection: false, transports: ['websocket'] });
    sockets.push(again);
    assert.deepEqual(await history(again), ['by the bins', 'hello all']);
    again.on('chat-message', (m) => got.get(priya).push(m.text));

    // Turning hider for a look, before the game: the seeker is sent the chat
    // afresh, with nothing the hiders said before, and what they'd said to
    // the seekers is gone too when they turn back
    let fresh = history(host.socket);
    await ack(host.socket, 'update-player', { is_seeker: false });
    assert.deepEqual(await fresh, ['hello all']);
    await ack(maya.socket, 'chat-send', { text: 'who is this?', channel: 'hiders' });
    await settle();
    assert.equal(got.get(host).at(-1), 'who is this?', 'while on the side, they are sent what is said on it');
    fresh = history(host.socket);
    await ack(host.socket, 'update-player', { is_seeker: true });
    assert.deepEqual(await fresh, ['hello all']);

    // In a game, a hider who is caught: the hiders' chat goes from their
    // phone, and the seekers' starts from now
    lobby.players.get(host.data.player_token).chat_times = [];
    lobby.players.get(maya.data.player_token).chat_times = [];
    await ack(host.socket, 'start-game');
    await ack(host.socket, 'chat-send', { text: 'she is near the library', channel: 'seekers' });
    fresh = history(maya.socket);
    assert.equal((await ack(maya.socket, 'found', NEAR)).status, 'success');
    assert.deepEqual(await fresh, ['hello all']);
    got.get(maya).length = 0;
    await ack(priya.socket, 'chat-send', { text: 'they got Maya', channel: 'hiders' });
    await ack(host.socket, 'chat-send', { text: 'one to go', channel: 'seekers' });
    await settle();
    assert.deepEqual(got.get(maya), ['one to go']);
    assert.equal((await ack(maya.socket, 'chat-send', { text: 'run!', channel: 'hiders' })).status, 'wrong_side', 'and they can\'t write to the hiders any more');
    assert.equal((await ack(maya.socket, 'chat-send', { text: 'where next?', channel: 'seekers' })).status, 'success');

    // Back to the lobby: she is a hider again, and the hiders' chat starts over for her
    fresh = history(maya.socket);
    await ack(host.socket, 'reset-game');
    assert.deepEqual(await fresh, ['hello all']);
});

test('someone who joins late is given everyone\'s chat, not what a side said before they came', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    await ack(host.socket, 'chat-send', { text: 'welcome' });
    await ack(host.socket, 'chat-send', { text: 'just us hiders', channel: 'hiders' });
    // (the host is a hider too until they choose otherwise, like everyone who joins)
    const late = connect(base, { path: SOCKET_PATH, auth: { lobby_id: lobbyId }, reconnection: false, transports: ['websocket'] });
    sockets.push(late);
    const history = await new Promise((resolve) => late.once('chat-history', resolve));
    assert.deepEqual(history.messages.map((m) => m.text), ['welcome']);
    // From now on they're one of the hiders
    const heard = new Promise((resolve) => late.once('chat-message', resolve));
    await ack(host.socket, 'chat-send', { text: 'and now you', channel: 'hiders' });
    assert.equal((await heard).text, 'and now you');
});

test('a picture in the chat reaches everyone as a message, and is fetched by its own address', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const maya = await join({ lobby_id: lobbyId });
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x60, 0x02, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(500, 3)]);
    const lobby = game.lobbies.get(lobbyId);
    const fetchImage = (lobbyPart, imagePart) => fetch(`${base}/manhunt-api/chat-image/${lobbyPart}/${imagePart}`);

    // A picture alone: the message says where it is and how big, and carries none of it
    const heard = new Promise((resolve) => maya.socket.once('chat-message', resolve));
    const sent = await ack(host.socket, 'chat-send', { image: { data: jpeg, width: 640, height: 480 } });
    assert.equal(sent.status, 'success');
    const message = await heard;
    assert.equal(message.text, '');
    assert.deepEqual(Object.keys(message.image).sort(), ['height', 'id', 'type', 'width']);
    assert.deepEqual([message.image.type, message.image.width, message.image.height], ['image/jpeg', 640, 480]);

    // Fetched by anyone who has the lobby's ID and the picture's: the same bytes, as a picture
    const response = await fetchImage(lobbyId, message.image.id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(jpeg));

    // With words, and the other kind
    const both = await ack(maya.socket, 'chat-send', { text: '  by the fountain ', image: { data: webp, width: 30, height: 40 } });
    assert.deepEqual([both.message.text, both.message.image.type], ['by the fountain', 'image/webp']);
    assert.equal((await fetchImage(lobbyId, both.message.image.id)).headers.get('content-type'), 'image/webp');

    // Someone joining late gets the messages, pictures still to fetch
    const late = connect(base, { path: SOCKET_PATH, auth: { lobby_id: lobbyId }, reconnection: false, transports: ['websocket'] });
    sockets.push(late);
    const history = await new Promise((resolve) => late.once('chat-history', resolve));
    assert.deepEqual(history.messages.map((m) => m.image.id), [message.image.id, both.message.image.id]);
    assert.ok(JSON.stringify(history).length < 1000, 'the history carries no picture');

    // Nothing answers for a picture that isn't there
    for (const [lobbyPart, imagePart] of [[lobbyId, 'nope'], ['nope', message.image.id], ['__proto__', 'constructor'], [lobbyId, '__proto__']]) {
        assert.equal((await fetchImage(lobbyPart, imagePart)).status, 404, `${lobbyPart}/${imagePart}`);
    }

    // What isn't a picture this server keeps is refused, words and all
    const tooBig = Buffer.concat([jpeg.subarray(0, 4), Buffer.alloc(72_000)]);
    const refused = [
        { image: { data: Buffer.from('<svg onload=alert(1)>'), width: 10, height: 10 } },
        { image: { data: tooBig, width: 10, height: 10 } },
        { image: { data: jpeg, width: 0, height: 10 } },
        { image: { data: jpeg.toString('base64'), width: 10, height: 10 } },
        { image: 'picture' },
        { text: 'a caption', image: {} },
        { text: 'x'.repeat(281), image: { data: jpeg, width: 10, height: 10 } },
        { text: 7, image: { data: jpeg, width: 10, height: 10 } },
    ];
    for (const bad of refused) {
        assert.equal((await ack(maya.socket, 'chat-send', bad)).status, 'validation_error', JSON.stringify(bad).slice(0, 60));
    }
    assert.deepEqual([lobby.chat.length, lobby.chat_images.size], [2, 2], 'nothing refused is kept');
});

test('a lobby keeps only its newest pictures, and no one can flood it with them', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const lobby = game.lobbies.get(lobbyId);
    const player = lobby.players.get(host.data.player_token);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    const picture = { image: { data: jpeg, width: 4, height: 3 } };

    // Four in a row go through; the fifth has to wait, though words still don't
    for (let i = 1; i <= 4; i++) assert.equal((await ack(host.socket, 'chat-send', picture)).status, 'success');
    player.chat_times = [];
    const fifth = await ack(host.socket, 'chat-send', picture);
    assert.deepEqual([fifth.status, /pictures/.test(fifth.description)], ['too_fast', true]);
    assert.equal((await ack(host.socket, 'chat-send', { text: 'words are fine' })).status, 'success');
    assert.equal(lobby.chat_images.size, 4);

    // The lobby keeps 40 pictures: the next one pushes the oldest out, and its message says so
    const oldest = lobby.chat[0];
    for (let i = 5; i <= 40; i++) lobby.chat_images.set(`filler-${i}`, { bytes: jpeg, type: 'image/jpeg' });
    player.chat_times = [];
    player.chat_image_times = [];
    const newest = await ack(host.socket, 'chat-send', picture);
    assert.equal(newest.status, 'success');
    assert.equal(lobby.chat_images.size, 40);
    assert.equal(lobby.chat_images.has(oldest.image.id), false);
    assert.equal(lobby.chat[0].image.gone, true);
    assert.equal(oldest.image.gone, undefined, 'the copy already sent to phones is not changed');
    assert.equal(lobby.chat[1].image.gone, undefined);
    assert.equal((await fetch(`${base}/manhunt-api/chat-image/${lobbyId}/${oldest.image.id}`)).status, 404);
    assert.equal((await fetch(`${base}/manhunt-api/chat-image/${lobbyId}/${newest.message.image.id}`)).status, 200);

    // A message that drops off the end of the history takes its picture with it
    const second = lobby.chat[1];
    const last = lobby.chat.at(-1).id;
    lobby.chat = [second, ...Array.from({ length: 199 }, (_, i) => ({ id: last + i + 1, player_id: 1, name: 'Hank', text: `old ${i}`, at: Date.now() }))];
    lobby.next_message_id = last + 200;
    player.chat_times = [];
    assert.equal((await ack(host.socket, 'chat-send', { text: 'one more' })).status, 'success');
    assert.equal(lobby.chat.length, 200);
    assert.equal(lobby.chat_images.has(second.image.id), false);
});

test('the health check reports which update the server runs', { skip }, async () => {
    const health = await (await fetch(`${base}/manhunt-api/health`)).json();
    assert.equal(health.status, 'success');
    assert.match(health.version.commit, /^[0-9a-f]{7,}$/);
    assert.ok(Number.isInteger(health.version.build) && health.version.build > 0);
});

test('the built app is served compressed, and unknown paths get the app', { skip }, async () => {
    const distDir = mkdtempSync(path.join(tmpdir(), 'manhunt-dist-'));
    writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Manhunt</title>');
    const script = 'const padding = "manhunt";\n'.repeat(4000);
    writeFileSync(path.join(distDir, 'app.js'), script);
    const served = createGameServer({ distDir, push: fakePush });
    await new Promise((resolve) => served.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${served.server.address().port}`;
    try {
        const zipped = await fetch(`${origin}/app.js`, { headers: { 'Accept-Encoding': 'gzip' } });
        assert.equal(zipped.headers.get('content-encoding'), 'gzip');
        assert.equal(await zipped.text(), script, 'and arrives whole');
        const plain = await fetch(`${origin}/app.js`, { headers: { 'Accept-Encoding': 'identity' } });
        assert.equal(plain.headers.get('content-encoding'), null, 'only for a browser that asks');
        await plain.arrayBuffer();
        assert.match(await (await fetch(`${origin}/lobby/abc`)).text(), /<title>Manhunt<\/title>/);
        assert.equal((await (await fetch(`${origin}/manhunt-api/health`)).json()).status, 'success');
    } finally {
        await served.close();
        rmSync(distDir, { recursive: true, force: true });
    }
});

test('players can subscribe to push, but only through real push services', { skip }, async () => {
    const { host } = await hostedLobby();
    assert.equal(host.data.push_public_key, 'test-public-key', 'join hands out the key to subscribe with');
    for (const endpoint of ['http://192.168.1.1/push', 'https://evil.example.com/x', 'https://push.apple.com.evil.com/x', 'not a url']) {
        const bad = await ack(host.socket, 'push-subscribe', { subscription: { ...subscription('x'), endpoint } });
        assert.equal(bad.status, 'validation_error', endpoint);
    }
    assert.equal((await ack(host.socket, 'push-subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: {} } })).status, 'validation_error', 'needs keys');
    assert.equal((await ack(host.socket, 'push-subscribe', { subscription: subscription('ok') })).status, 'success');
    assert.equal((await ack(host.socket, 'push-subscribe', { subscription: null })).status, 'success', 'and can stop');
});

test('a find is pushed to the other players who are not looking at the app', { skip }, async () => {
    const { lobbyId, host, near, far } = await foundGame();
    await ack(host.socket, 'push-subscribe', { subscription: subscription('host') });
    await ack(near.socket, 'push-subscribe', { subscription: subscription('near') });
    await ack(far.socket, 'push-subscribe', { subscription: subscription('far') });
    await ack(far.socket, 'set-visibility', { visible: false });   // Priya's phone is locked
    await ack(host.socket, 'start-game');

    pushed.length = 0;
    await ack(near.socket, 'found', NEAR);
    await new Promise((r) => setTimeout(r, 50));
    const name = game.lobbies.get(lobbyId).players.get(near.data.player_token).name;
    assert.deepEqual(pushed.map((p) => p.endpoint), ['https://web.push.apple.com/far'],
        'only the locked phone: not the one found, not the host who is looking at the app');
    assert.deepEqual(pushed[0].payload, {
        title: `${name} was found`, body: '1 hider left · Hosted', url: `/lobby/${lobbyId}`, tag: `manhunt-${lobbyId}`
    });

    // The host locks their phone too; the last find says everyone is found
    await ack(host.socket, 'set-visibility', { visible: false });
    pushed.length = 0;
    await ack(far.socket, 'found', NEAR);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(pushed.map((p) => p.endpoint), ['https://web.push.apple.com/host']);
    assert.equal(pushed[0].payload.title, 'Everyone was found');
    assert.match(pushed[0].payload.body, /was the last\. The seekers win\./);
});

test('a player away from the app is reminded shortly before being removed', { skip }, async () => {
    const { lobbyId, host } = await hostedLobby();
    const away = await join({ lobby_id: lobbyId });
    const quiet = await join({ lobby_id: lobbyId });
    await ack(away.socket, 'push-subscribe', { subscription: subscription('away') });
    const lobby = game.lobbies.get(lobbyId);
    const awayPlayer = lobby.players.get(away.data.player_token);
    const quietPlayer = lobby.players.get(quiet.data.player_token);
    away.socket.disconnect();
    quiet.socket.disconnect(); // no subscription: nothing to send
    await new Promise((r) => setTimeout(r, 50));
    const sent = () => pushed.filter((p) => p.payload.tag === `manhunt-${lobbyId}-away`);

    pushed.length = 0;
    awayPlayer.disconnected_at = quietPlayer.disconnected_at = Date.now() - 60_000; // away 1 min
    game.cleanupExpired();
    assert.equal(sent().length, 0, 'not yet');

    // (1.4 min left, not 1.5: exactly a minute and a half is where the reminder starts, and
    // reads as "1 minute" or "2 minutes" by the millisecond)
    awayPlayer.disconnected_at = quietPlayer.disconnected_at = Date.now() - 3.6 * 60_000;
    game.cleanupExpired();
    assert.equal(sent().length, 1, 'reminded once the end is near');
    assert.deepEqual(sent()[0].payload, {
        title: 'Still playing in Hosted?',
        body: "Open Manhunt within 1 minute or you'll be taken out of the lobby.",
        url: `/lobby/${lobbyId}`,
        tag: `manhunt-${lobbyId}-away`
    });
    assert.ok(sent()[0].options.ttl <= 90 && sent()[0].options.ttl > 80, 'not delivered after it stops mattering');
    game.cleanupExpired();
    assert.equal(sent().length, 1, 'only once');

    // Coming back resets it: a later absence is reminded again
    const back = await join({ lobby_id: lobbyId, player_token: away.data.player_token });
    assert.equal(awayPlayer.connected, true);
    back.socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    awayPlayer.disconnected_at = Date.now() - 4.5 * 60_000;
    game.cleanupExpired();
    assert.equal(sent().length, 2, 'reminded again after another absence');
    assert.match(sent()[1].payload.body, /within 1 minute or/);

    awayPlayer.disconnected_at = 0;
    game.cleanupExpired();
    assert.equal(lobby.players.has(away.data.player_token), false, 'and removed when the time is up');
    assert.ok(host.socket.connected);
});

test('a subscription the push service says is gone is forgotten', { skip }, async () => {
    const { lobbyId, host, near, far } = await foundGame();
    await ack(far.socket, 'push-subscribe', { subscription: subscription('gone') });
    await ack(far.socket, 'set-visibility', { visible: false });
    await ack(host.socket, 'start-game');
    await ack(near.socket, 'found', NEAR);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(game.lobbies.get(lobbyId).players.get(far.data.player_token).push_subscription, null);
});
