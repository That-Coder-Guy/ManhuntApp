#!/usr/bin/env node
/**
 * Keeps the permanent workers.dev address pointed at this server.
 *
 * A Cloudflare quick tunnel gets a new https://….trycloudflare.com address
 * each time it starts. This watches the tunnel and, whenever its address
 * changes and answers, tells the Worker (cloudflare/worker.js), which
 * forwards players there. scripts/setup-server.sh installs it as the
 * manhunt-publish service.
 *
 * Environment:
 *   WORKER_URL       The Worker's address, https://manhunt.<you>.workers.dev
 *   PUBLISH_SECRET   Shared with the Worker
 *   QUICK_METRICS    cloudflared's metrics address (127.0.0.1:20241)
 */

import { pathToFileURL } from 'node:url';

const CONTROL_PATH = '/__manhunt/tunnel';
const CHECK_EVERY_MS = 10_000;
const RETRY_AFTER_ERROR_MS = 30_000;
// Now and then, make sure the Worker still has our address (say, after it
// was redeployed with an empty store)
const VERIFY_EVERY_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

const timeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

/** The quick tunnel's current origin, or null while it has none. */
export async function currentTunnelOrigin(metrics, fetchImpl = fetch)
{
    try {
        const response = await fetchImpl(`http://${metrics}/quicktunnel`, { signal: timeout() });
        if (!response.ok) return null;
        const { hostname } = await response.json();
        return typeof hostname === 'string' && /^[a-z0-9-]+\.trycloudflare\.com$/.test(hostname) ? `https://${hostname}` : null;
    } catch {
        return null;
    }
}

async function answers(origin, fetchImpl)
{
    try {
        return (await fetchImpl(`${origin}/manhunt-api/health`, { signal: timeout() })).ok;
    } catch {
        return false;
    }
}

/** Tell the Worker the address. Resolves with null, or a description of what went wrong. */
export async function tellWorker({ workerUrl, secret }, origin, fetchImpl = fetch)
{
    try {
        const response = await fetchImpl(`${workerUrl}${CONTROL_PATH}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin }),
            signal: timeout()
        });
        if (response.ok) return null;
        const body = (await response.text().catch(() => '')).slice(0, 160);
        const hint = response.status === 401 ? ' (the secret doesn\'t match the Worker\'s; re-run setup-server.sh with --cf-api-token)' : '';
        return `The Worker answered ${response.status}${hint}: ${body}`;
    } catch (error) {
        return `Couldn't reach the Worker: ${error.message}`;
    }
}

/** The address the Worker currently forwards to, or undefined if it can't be asked. */
export async function workerOrigin({ workerUrl }, fetchImpl = fetch)
{
    try {
        const response = await fetchImpl(`${workerUrl}${CONTROL_PATH}`, { signal: timeout() });
        return response.ok ? (await response.json()).origin ?? null : undefined;
    } catch {
        return undefined;
    }
}

/**
 * One check. Resolves with what happened: 'no-address', 'unchanged',
 * 'not-answering', 'published' or 'failed' (with `detail`).
 */
export async function publishIfChanged({ config, lastPublished, fetchImpl = fetch })
{
    const origin = await currentTunnelOrigin(config.metrics, fetchImpl);
    if (!origin) return { result: 'no-address' };
    if (origin === lastPublished) return { result: 'unchanged', origin };
    // Don't send players to an address that doesn't work yet
    if (!(await answers(origin, fetchImpl))) return { result: 'not-answering', origin };
    const problem = await tellWorker(config, origin, fetchImpl);
    return problem ? { result: 'failed', origin, detail: problem } : { result: 'published', origin };
}

function readConfig(env)
{
    const missing = ['WORKER_URL', 'PUBLISH_SECRET'].filter((name) => !env[name]);
    if (missing.length) throw new Error(`Missing ${missing.join(' and ')}`);
    return {
        workerUrl: env.WORKER_URL.replace(/\/+$/, ''),
        secret: env.PUBLISH_SECRET,
        metrics: env.QUICK_METRICS || '127.0.0.1:20241'
    };
}

async function main()
{
    const config = readConfig(process.env);
    let lastPublished = '';
    let lastVerified = Date.now();
    let lastResult = '';

    console.log(`Watching the tunnel at ${config.metrics}; players use ${config.workerUrl}`);
    for (;;) {
        const { result, origin, detail } = await publishIfChanged({ config, lastPublished });
        if (result === 'published') {
            lastPublished = origin;
            lastVerified = Date.now();
            console.log(`Published ${origin}`);
        } else if (result === 'failed') {
            console.error(detail);
        } else if (result === 'unchanged' && Date.now() - lastVerified > VERIFY_EVERY_MS) {
            lastVerified = Date.now();
            const forwarded = await workerOrigin(config);
            if (forwarded !== undefined && forwarded !== origin) {
                console.log(`The Worker forwards to ${forwarded}; publishing again`);
                lastPublished = '';
            }
        } else if (result !== lastResult && result !== 'unchanged') {
            console.log(result === 'no-address' ? 'Waiting for the tunnel to get an address…' : `Waiting for ${origin} to answer…`);
        }
        lastResult = result;
        await new Promise((resolve) => setTimeout(resolve, result === 'failed' ? RETRY_AFTER_ERROR_MS : CHECK_EVERY_MS));
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
