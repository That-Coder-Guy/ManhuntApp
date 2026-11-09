// Manhunt's permanent address: a Cloudflare Worker on https://<name>.<you>.workers.dev
//
// The game server runs on a Raspberry Pi behind a free Cloudflare quick tunnel,
// whose https://….trycloudflare.com address changes whenever the tunnel
// restarts. This Worker keeps one address that never changes and forwards
// every request (pages, API calls and the game's WebSocket) to wherever the
// tunnel is right now. The Pi tells it (scripts/publish-address.mjs):
//
//   POST /__manhunt/tunnel   Authorization: Bearer <PUBLISH_SECRET>
//                            {"origin":"https://calm-river.trycloudflare.com"}
//   GET  /__manhunt/tunnel   → {"origin": "https://…" | null}
//
// Bindings (scripts/deploy-worker.mjs sets them up):
//   TUNNEL           KV namespace that remembers the address
//   PUBLISH_SECRET   shared with the Pi; only it may change the address

const CONTROL_PATH = '/__manhunt/tunnel';
const ORIGIN_KEY = 'origin';
const TUNNEL_ORIGIN = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
// Each Worker instance re-reads the address at most this often
const MEMORY_TTL_MS = 10_000;

let remembered = { origin: null, at: 0 };

async function tunnelOrigin(env)
{
    if (Date.now() - remembered.at < MEMORY_TTL_MS) return remembered.origin;
    const origin = await env.TUNNEL.get(ORIGIN_KEY, { cacheTtl: 30 });
    remembered = { origin, at: Date.now() };
    return origin;
}

// Compare without leaking how much of the secret matched
function sameSecret(given, expected)
{
    const a = new TextEncoder().encode(given);
    const b = new TextEncoder().encode(expected);
    let diff = a.length ^ b.length;
    for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
    return diff === 0 && b.length > 0;
}

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function control(request, env)
{
    if (request.method === 'GET') return json({ origin: await tunnelOrigin(env) });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const auth = request.headers.get('Authorization') || '';
    if (!sameSecret(auth.replace(/^Bearer /, ''), env.PUBLISH_SECRET || '')) return json({ error: 'unauthorized' }, 401);

    const body = await request.json().catch(() => null);
    const origin = typeof body?.origin === 'string' ? body.origin.trim().replace(/\/+$/, '') : '';
    if (!TUNNEL_ORIGIN.test(origin)) return json({ error: 'not_a_quick_tunnel_address' }, 400);

    await env.TUNNEL.put(ORIGIN_KEY, origin);
    remembered = { origin, at: Date.now() };
    return json({ origin });
}

function offline(request)
{
    const url = new URL(request.url);
    if (url.pathname.startsWith('/manhunt-api')) return json({ status: 'server_offline' }, 503);
    return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        + '<title>Manhunt</title><body style="font:16px system-ui;padding:24px;background:#111;color:#eee">'
        + '<h1 style="font-size:20px">The game server is offline</h1>'
        + '<p>Ask whoever runs it to start it, then reload this page.</p>',
        { status: 503, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30' } });
}

export default {
    async fetch(request, env)
    {
        const url = new URL(request.url);
        if (url.pathname === CONTROL_PATH) return control(request, env);

        const origin = await tunnelOrigin(env);
        if (!origin) return offline(request);

        const target = new URL(url.pathname + url.search, origin);
        // Host comes from the target; the rest (cookies, Upgrade, …) passes through
        const headers = new Headers(request.headers);
        headers.delete('Host');
        let response;
        try {
            // Same method, headers and body; an Upgrade: websocket header makes
            // this a WebSocket that the runtime connects end to end
            const forwarded = new Request(target, request); // same method and body
            response = await fetch(new Request(forwarded, { headers, redirect: 'manual' }));
        } catch {
            return offline(request);
        }
        // 530: Cloudflare can't reach the tunnel (the Pi is off, or the address is stale)
        if (response.status === 530) {
            remembered.at = 0; // look the address up again next time
            return offline(request);
        }
        return response;
    }
};
