import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerOrigin } from '../shared/serverOrigin.js';
import { globalConfigRequest, publishIfChanged, writeOrigin, writeOriginFindingTeam } from '../scripts/publish-address.mjs';
import handler from '../api/server-origin.js';

const TUNNEL = 'https://calm-river-otter.trycloudflare.com';

test('normalizeServerOrigin keeps only HTTPS origins', () => {
    assert.equal(normalizeServerOrigin(`${TUNNEL}/some/path?x=1`), TUNNEL);
    assert.equal(normalizeServerOrigin(` ${TUNNEL} `), TUNNEL);
    assert.equal(normalizeServerOrigin('http://localhost:3001'), 'http://localhost:3001');
    for (const bad of ['http://calm-river.trycloudflare.com', 'javascript:alert(1)', 'https://user:pw@x.com', 'nope', '', null, 42, {}]) {
        assert.equal(normalizeServerOrigin(bad), null, String(bad));
    }
});

test('globalConfigRequest upserts the address, with the team when given', () => {
    const { url, init } = globalConfigRequest({ token: 'tok', globalConfigId: 'ecfg_abc', origin: TUNNEL });
    assert.equal(url, 'https://api.vercel.com/v1/global-config/ecfg_abc/items');
    assert.equal(init.method, 'PATCH');
    assert.equal(init.headers.Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(init.body), { items: [{ operation: 'upsert', key: 'server_origin', value: TUNNEL }] });
    assert.match(globalConfigRequest({ token: 't', globalConfigId: 'ecfg_abc', teamId: 'team_1', origin: TUNNEL }).url, /\?teamId=team_1$/);
});

// A fetch stand-in: the tunnel's metrics, its health check, and Vercel's API
function fakeFetch({ hostname = 'calm-river-otter.trycloudflare.com', healthy = true, vercelStatus = 200, vercel } = {})
{
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url, method: init.method || 'GET' });
        if (url.endsWith('/quicktunnel')) {
            return hostname ? Response.json({ hostname }) : new Response('', { status: 404 });
        }
        if (url.endsWith('/manhunt-api/health')) return new Response('{}', { status: healthy ? 200 : 530 });
        if (url.startsWith('https://api.vercel.com/')) {
            if (vercel) return vercel(url, JSON.parse(init.body).items[0].operation);
            return new Response('{"error":"x"}', { status: vercelStatus });
        }
        throw new Error(`unexpected ${url}`);
    };
    return { fetchImpl, calls };
}

const config = { token: 'tok', globalConfigId: 'ecfg_abc', metrics: '127.0.0.1:20241' };

test('publishes a new address once it answers', async () => {
    const { fetchImpl, calls } = fakeFetch();
    assert.deepEqual(await publishIfChanged({ config, lastPublished: '', fetchImpl }), { result: 'published', origin: TUNNEL });
    assert.deepEqual(calls.map((c) => c.method), ['GET', 'GET', 'PATCH']);
});

test('does not write when the address is unchanged, missing, or not answering', async () => {
    let fake = fakeFetch();
    assert.equal((await publishIfChanged({ config, lastPublished: TUNNEL, fetchImpl: fake.fetchImpl })).result, 'unchanged');
    assert.equal(fake.calls.length, 1);

    fake = fakeFetch({ hostname: '' });
    assert.equal((await publishIfChanged({ config, lastPublished: '', fetchImpl: fake.fetchImpl })).result, 'no-address');

    fake = fakeFetch({ healthy: false });
    assert.equal((await publishIfChanged({ config, lastPublished: '', fetchImpl: fake.fetchImpl })).result, 'not-answering');
    assert.ok(!fake.calls.some((c) => c.method === 'PATCH'));
});

test('reports a rejected token with a hint', async () => {
    const { fetchImpl } = fakeFetch({ vercelStatus: 403 });
    const outcome = await publishIfChanged({ config, lastPublished: '', fetchImpl });
    assert.equal(outcome.result, 'failed');
    assert.match(outcome.detail, /403.*Full Account or team scope/);
});

test('the Vercel function answers null, uncached, when no Global Config is connected', async () => {
    const saved = { GLOBAL_CONFIG: process.env.GLOBAL_CONFIG, EDGE_CONFIG: process.env.EDGE_CONFIG };
    delete process.env.GLOBAL_CONFIG;
    delete process.env.EDGE_CONFIG;
    const headers = {};
    let status, body;
    const res = {
        setHeader: (k, v) => { headers[k] = v; },
        status: (s) => { status = s; return res; },
        json: (b) => { body = b; }
    };
    const error = console.error;
    console.error = () => {};
    try { await handler({}, res); }
    finally {
        console.error = error;
        for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
    }
    assert.equal(status, 200);
    assert.deepEqual(body, { origin: null });
    assert.equal(headers['Cache-Control'], 'no-store');
});

const ITEM_NOT_FOUND = () => new Response('{"error":{"code":"not_found","message":"Edge Config Item not found."}}', { status: 404 });

test('falls back to "create" when upsert says the item is not found', async () => {
    // What a Pi saw: the store exists, but upsert of a new key is refused
    const tried = [];
    const vercel = (url, op) => {
        tried.push(`${url.split('/')[4]} ${op}`);
        return op === 'create' && url.includes('/global-config/') ? Response.json({ status: 'ok' }) : ITEM_NOT_FOUND();
    };
    const { fetchImpl } = fakeFetch({ vercel });
    const cfg = { ...config };
    assert.equal((await publishIfChanged({ config: cfg, lastPublished: '', fetchImpl })).result, 'published');
    assert.deepEqual(tried, ['global-config upsert', 'global-config create']);

    // The way that worked is tried first next time
    tried.length = 0;
    assert.equal((await publishIfChanged({ config: cfg, lastPublished: 'https://old.trycloudflare.com', fetchImpl })).result, 'published');
    assert.deepEqual(tried, ['global-config create']);
});

test('falls back to the older edge-config API', async () => {
    const vercel = (url) => (url.includes('/edge-config/') ? Response.json({ status: 'ok' }) : new Response('Not Found', { status: 404 }));
    const { fetchImpl } = fakeFetch({ vercel });
    const written = await writeOrigin(config, TUNNEL, fetchImpl);
    assert.equal(written.ok, true);
    assert.deepEqual(written.attempt, { api: 'edge-config', operation: 'upsert' });
});

test('a refused token stops at the first try; all-404 names the store ID', async () => {
    let count = 0;
    let { fetchImpl } = fakeFetch({ vercel: () => { count++; return new Response('{}', { status: 403 }); } });
    let outcome = await publishIfChanged({ config: { ...config }, lastPublished: '', fetchImpl });
    assert.equal(count, 1);
    assert.match(outcome.detail, /403.*Full Account or team scope/);

    ({ fetchImpl } = fakeFetch({ vercel: ITEM_NOT_FOUND }));
    outcome = await publishIfChanged({ config: { ...config }, lastPublished: '', fetchImpl });
    assert.equal(outcome.result, 'failed');
    assert.match(outcome.detail, /^Vercel answered 404 \(check GLOBAL_CONFIG_ID.*Tried: global-config upsert → 404, global-config create → 404, edge-config upsert → 404, edge-config create → 404/);
});

test('finds the team that owns the store when the personal scope is refused', async () => {
    // What a Pi saw: no team in the request → upsert 404, create 403
    const tried = [];
    const vercel = (url, op) => {
        const team = new URL(url).searchParams.get('teamId');
        tried.push(`${op}${team ? ` ${team}` : ''}`);
        if (team === 'team_owner') return Response.json({ status: 'ok' });
        if (team) return new Response('{}', { status: 403 });
        return op === 'upsert' ? ITEM_NOT_FOUND() : new Response('{"error":{"code":"forbidden"}}', { status: 403 });
    };
    const { fetchImpl: base } = fakeFetch({ vercel });
    const fetchImpl = async (url, init) => (String(url).startsWith('https://api.vercel.com/v2/teams')
        ? Response.json({ teams: [{ id: 'team_other', slug: 'other' }, { id: 'team_owner', slug: 'hgglenn518-6656' }] })
        : base(url, init));

    const cfg = { ...config };
    const logs = [];
    const written = await writeOriginFindingTeam(cfg, TUNNEL, fetchImpl, (line) => logs.push(line));
    assert.equal(written.ok, true);
    assert.equal(cfg.teamId, 'team_owner');
    assert.deepEqual(tried, ['upsert', 'create', 'upsert team_other', 'upsert team_owner']);
    assert.match(logs[0], /hgglenn518-6656 \(team_owner\)/);

    // A team given explicitly is trusted: no lookup
    tried.length = 0;
    const given = await writeOriginFindingTeam({ ...config, teamId: 'team_other', teamGiven: true }, TUNNEL, fetchImpl);
    assert.equal(given.ok, false);
    assert.deepEqual(tried, ['upsert team_other']);
});

test('says when the token cannot list teams (a project-scoped token)', async () => {
    const vercel = (url, op) => (op === 'upsert' ? ITEM_NOT_FOUND() : new Response('{"error":{"code":"forbidden"}}', { status: 403 }));
    const { fetchImpl: base } = fakeFetch({ vercel });
    const fetchImpl = async (url, init) => (String(url).startsWith('https://api.vercel.com/v2/teams')
        ? new Response('{"error":{"code":"forbidden"}}', { status: 403 })
        : base(url, init));
    const outcome = await publishIfChanged({ config: { ...config }, lastPublished: '', fetchImpl });
    assert.equal(outcome.result, 'failed');
    assert.match(outcome.detail, /Full Account or team scope.*the token can't list teams \(403\)/);
});
