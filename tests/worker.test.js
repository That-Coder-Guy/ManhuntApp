import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.js';
import { deployWorker, workerUpload } from '../scripts/deploy-worker.mjs';
import { publishIfChanged } from '../scripts/publish-address.mjs';

const SITE = 'https://manhunt.hank.workers.dev';
const TUNNEL = 'https://calm-river-otter.trycloudflare.com';
const SECRET = 's'.repeat(43);

// A KV namespace stand-in; each test gets a fresh one and a fresh time so the
// Worker's in-memory copy of the address doesn't leak between tests
function kv(initial = {})
{
    const data = new Map(Object.entries(initial));
    return { get: async (k) => data.get(k) ?? null, put: async (k, v) => { data.set(k, v); }, data };
}

let clock = 1e12;
function freshTime(t)
{
    const realNow = Date.now;
    clock += 60_000;
    Date.now = () => clock;
    t.after(() => { Date.now = realNow; });
}

function withFetch(t, impl)
{
    const real = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push(request);
        return impl(request);
    };
    t.after(() => { globalThis.fetch = real; });
    return calls;
}

const publish = (origin, secret = SECRET) => new Request(`${SITE}/__manhunt/tunnel`, {
    method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin })
});

test('the Worker only takes a quick-tunnel address, and only with the secret', async (t) => {
    freshTime(t);
    const env = { TUNNEL: kv(), PUBLISH_SECRET: SECRET };
    assert.equal((await worker.fetch(publish(TUNNEL, 'wrong'), env)).status, 401);
    assert.equal((await worker.fetch(publish('https://evil.example.com'), env)).status, 400);
    assert.equal(env.TUNNEL.data.size, 0);

    const ok = await worker.fetch(publish(`${TUNNEL}/`), env);
    assert.equal(ok.status, 200);
    assert.equal(env.TUNNEL.data.get('origin'), TUNNEL);
    const status = await worker.fetch(new Request(`${SITE}/__manhunt/tunnel`), env);
    assert.deepEqual(await status.json(), { origin: TUNNEL });
});

test('the Worker forwards requests to the tunnel, keeping method, path, body and headers', async (t) => {
    freshTime(t);
    const calls = withFetch(t, async () => new Response('{"lobby_id":"x"}', { status: 200 }));
    const env = { TUNNEL: kv({ origin: TUNNEL }), PUBLISH_SECRET: SECRET };
    const response = await worker.fetch(new Request(`${SITE}/manhunt-api/create-lobby?x=1`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'a=b' }, body: '{"lobby_name":"Park"}'
    }), env);
    assert.equal(response.status, 200);
    const sent = calls[0];
    assert.equal(sent.url, `${TUNNEL}/manhunt-api/create-lobby?x=1`);
    assert.equal(sent.method, 'POST');
    assert.equal(sent.headers.get('cookie'), 'a=b');
    assert.equal(await sent.text(), '{"lobby_name":"Park"}');
});

test('the Worker says the server is offline when there is no tunnel or it is unreachable', async (t) => {
    freshTime(t);
    let env = { TUNNEL: kv(), PUBLISH_SECRET: SECRET };
    let response = await worker.fetch(new Request(`${SITE}/manhunt-api/health`), env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'server_offline' });

    freshTime(t);
    withFetch(t, async () => new Response('error 1033', { status: 530 }));
    env = { TUNNEL: kv({ origin: TUNNEL }), PUBLISH_SECRET: SECRET };
    response = await worker.fetch(new Request(`${SITE}/lobby/abc`), env);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /game server is offline/);
});

// Cloudflare API stand-in for deployWorker
function cloudflareApi({ accounts = [{ id: 'acc1', name: 'Hank' }], subdomain = 'hank', namespaces = [] } = {})
{
    const calls = [];
    const ok = (result) => Response.json({ success: true, errors: [], result });
    const fetchImpl = async (url, init) => {
        const path = url.replace('https://api.cloudflare.com/client/v4', '');
        calls.push({ method: init.method, path, body: init.body });
        if (path.startsWith('/accounts?')) return ok(accounts);
        if (path.endsWith('/workers/subdomain') && init.method === 'GET') {
            return subdomain ? ok({ subdomain }) : Response.json({ success: false, errors: [{ code: 10007, message: 'not found' }] }, { status: 404 });
        }
        if (path.endsWith('/workers/subdomain') && init.method === 'PUT') return ok({ subdomain: JSON.parse(init.body).subdomain });
        if (path.includes('/storage/kv/namespaces') && init.method === 'GET') return ok(namespaces);
        if (path.includes('/storage/kv/namespaces') && init.method === 'POST') return ok({ id: 'ns-new', title: JSON.parse(init.body).title });
        if (path.includes('/workers/scripts/')) return ok({});
        throw new Error(`unexpected ${init.method} ${path}`);
    };
    return { fetchImpl, calls };
}

test('deployWorker uploads the Worker with its bindings and turns on workers.dev', async () => {
    const api = cloudflareApi();
    const url = await deployWorker({ token: 't', secret: SECRET, source: 'export default {}', fetchImpl: api.fetchImpl });
    assert.equal(url, 'https://manhunt.hank.workers.dev');
    assert.deepEqual(api.calls.map((c) => `${c.method} ${c.path}`), [
        'GET /accounts?per_page=50',
        'GET /accounts/acc1/workers/subdomain',
        'GET /accounts/acc1/storage/kv/namespaces?per_page=100',
        'POST /accounts/acc1/storage/kv/namespaces',
        'PUT /accounts/acc1/workers/scripts/manhunt',
        'POST /accounts/acc1/workers/scripts/manhunt/subdomain'
    ]);
    const form = api.calls[4].body;
    const metadata = JSON.parse(await form.get('metadata').text());
    assert.equal(metadata.main_module, 'worker.js');
    assert.deepEqual(metadata.bindings, [
        { type: 'kv_namespace', name: 'TUNNEL', namespace_id: 'ns-new' },
        { type: 'secret_text', name: 'PUBLISH_SECRET', text: SECRET }
    ]);
    assert.equal(await form.get('worker.js').text(), 'export default {}');
});

test('deployWorker reuses the KV namespace and registers a subdomain only when asked', async () => {
    let api = cloudflareApi({ namespaces: [{ id: 'ns-old', title: 'manhunt-tunnel' }] });
    await deployWorker({ token: 't', secret: SECRET, source: '', fetchImpl: api.fetchImpl });
    assert.ok(!api.calls.some((c) => c.method === 'POST' && c.path.includes('kv/namespaces')));

    api = cloudflareApi({ subdomain: null });
    await assert.rejects(deployWorker({ token: 't', secret: SECRET, source: '', fetchImpl: api.fetchImpl }), /--workers-subdomain/);
    api = cloudflareApi({ subdomain: null });
    assert.equal(await deployWorker({ token: 't', secret: SECRET, source: '', subdomain: 'hgglenn', fetchImpl: api.fetchImpl }),
        'https://manhunt.hgglenn.workers.dev');

    api = cloudflareApi({ accounts: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    await assert.rejects(deployWorker({ token: 't', secret: SECRET, source: '', fetchImpl: api.fetchImpl }), /--cf-account/);
});

test('workerUpload names the module part as the main module', async () => {
    const form = workerUpload('x', { namespaceId: 'n', secret: SECRET });
    assert.equal(form.get('worker.js').name, 'worker.js');
});

test('the publisher tells the Worker a new address once it answers', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
        calls.push(`${init.method || 'GET'} ${url}`);
        if (url.endsWith('/quicktunnel')) return Response.json({ hostname: 'calm-river-otter.trycloudflare.com' });
        if (url.endsWith('/manhunt-api/health')) return new Response('{}');
        if (url === `${SITE}/__manhunt/tunnel`) {
            assert.equal(init.headers.Authorization, `Bearer ${SECRET}`);
            assert.deepEqual(JSON.parse(init.body), { origin: TUNNEL });
            return Response.json({ origin: TUNNEL });
        }
        throw new Error(url);
    };
    const config = { workerUrl: SITE, secret: SECRET, metrics: '127.0.0.1:20241' };
    assert.deepEqual(await publishIfChanged({ config, lastPublished: '', fetchImpl }), { result: 'published', origin: TUNNEL });
    assert.equal(calls.length, 3);
    assert.equal((await publishIfChanged({ config, lastPublished: TUNNEL, fetchImpl })).result, 'unchanged');
});

test('the publisher explains a wrong secret', async () => {
    const fetchImpl = async (url) => {
        if (url.endsWith('/quicktunnel')) return Response.json({ hostname: 'calm-river-otter.trycloudflare.com' });
        if (url.endsWith('/manhunt-api/health')) return new Response('{}');
        return Response.json({ error: 'unauthorized' }, { status: 401 });
    };
    const outcome = await publishIfChanged({ config: { workerUrl: SITE, secret: 'x', metrics: 'm' }, lastPublished: '', fetchImpl });
    assert.equal(outcome.result, 'failed');
    assert.match(outcome.detail, /401.*--cf-api-token/);
});
