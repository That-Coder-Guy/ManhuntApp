import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerOrigin } from '../shared/serverOrigin.js';
import { edgeConfigRequest, publishIfChanged } from '../scripts/publish-address.mjs';
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

test('edgeConfigRequest upserts the address, with the team when given', () => {
    const { url, init } = edgeConfigRequest({ token: 'tok', edgeConfigId: 'ecfg_abc', origin: TUNNEL });
    assert.equal(url, 'https://api.vercel.com/v1/edge-config/ecfg_abc/items');
    assert.equal(init.method, 'PATCH');
    assert.equal(init.headers.Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(init.body), { items: [{ operation: 'upsert', key: 'server_origin', value: TUNNEL }] });
    assert.match(edgeConfigRequest({ token: 't', edgeConfigId: 'ecfg_abc', teamId: 'team_1', origin: TUNNEL }).url, /\?teamId=team_1$/);
});

// A fetch stand-in: the tunnel's metrics, its health check, and Vercel's API
function fakeFetch({ hostname = 'calm-river-otter.trycloudflare.com', healthy = true, vercelStatus = 200 } = {})
{
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url, method: init.method || 'GET' });
        if (url.endsWith('/quicktunnel')) {
            return hostname ? Response.json({ hostname }) : new Response('', { status: 404 });
        }
        if (url.endsWith('/manhunt-api/health')) return new Response('{}', { status: healthy ? 200 : 530 });
        if (url.startsWith('https://api.vercel.com/')) return new Response('{"error":"x"}', { status: vercelStatus });
        throw new Error(`unexpected ${url}`);
    };
    return { fetchImpl, calls };
}

const config = { token: 'tok', edgeConfigId: 'ecfg_abc', metrics: '127.0.0.1:20241' };

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
    assert.match(outcome.detail, /403.*VERCEL_TOKEN/);
});

test('the Vercel function answers null, uncached, when no Edge Config is connected', async () => {
    const saved = process.env.EDGE_CONFIG;
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
    finally { console.error = error; if (saved !== undefined) process.env.EDGE_CONFIG = saved; }
    assert.equal(status, 200);
    assert.deepEqual(body, { origin: null });
    assert.equal(headers['Cache-Control'], 'no-store');
});
