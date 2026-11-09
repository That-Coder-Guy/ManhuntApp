#!/usr/bin/env node
/**
 * Keeps a Vercel-hosted frontend pointed at this server.
 *
 * A Cloudflare quick tunnel gets a new https://….trycloudflare.com address
 * each time it starts. This watches the tunnel and, whenever its address
 * changes and answers, writes it to the Vercel project's Edge Config, where
 * the app's /api/server-origin reads it. scripts/setup-server.sh installs it
 * as the manhunt-publish service; it only writes when the address changes.
 *
 * Environment:
 *   VERCEL_TOKEN     Vercel access token (Account Settings → Tokens)
 *   EDGE_CONFIG_ID   The Edge Config store's ID (ecfg_…)
 *   VERCEL_TEAM_ID   Only if the project belongs to a Vercel team (team_…)
 *   QUICK_METRICS    cloudflared's metrics address (127.0.0.1:20241)
 *   STATE_DIRECTORY  Set by systemd; remembers the last published address
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SERVER_ORIGIN_KEY, normalizeServerOrigin } from '../shared/serverOrigin.js';

const CHECK_EVERY_MS = 10_000;
const RETRY_AFTER_ERROR_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

const timeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

/** The request that stores `origin` in Edge Config. */
export function edgeConfigRequest({ token, edgeConfigId, teamId, origin })
{
    const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    return {
        url: `https://api.vercel.com/v1/edge-config/${encodeURIComponent(edgeConfigId)}/items${query}`,
        init: {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ operation: 'upsert', key: SERVER_ORIGIN_KEY, value: origin }] })
        }
    };
}

/** The quick tunnel's current origin, or null while it has none. */
export async function currentTunnelOrigin(metrics, fetchImpl = fetch)
{
    try {
        const response = await fetchImpl(`http://${metrics}/quicktunnel`, { signal: timeout() });
        if (!response.ok) return null;
        const { hostname } = await response.json();
        return hostname ? normalizeServerOrigin(`https://${hostname}`) : null;
    } catch {
        return null;
    }
}

async function answers(origin, fetchImpl)
{
    try {
        const response = await fetchImpl(`${origin}/manhunt-api/health`, { signal: timeout() });
        return response.ok;
    } catch {
        return false;
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
    // Don't hand phones an address that doesn't work yet
    if (!(await answers(origin, fetchImpl))) return { result: 'not-answering', origin };

    const { url, init } = edgeConfigRequest({ ...config, origin });
    try {
        const response = await fetchImpl(url, { ...init, signal: timeout() });
        if (response.ok) return { result: 'published', origin };
        const body = await response.text().catch(() => '');
        const hint = response.status === 401 || response.status === 403
            ? ' (check VERCEL_TOKEN, and VERCEL_TEAM_ID if the project is in a team)'
            : response.status === 404 ? ' (check EDGE_CONFIG_ID)' : '';
        return { result: 'failed', origin, detail: `Vercel answered ${response.status}${hint}: ${body.slice(0, 200)}` };
    } catch (error) {
        return { result: 'failed', origin, detail: `Couldn't reach Vercel: ${error.message}` };
    }
}

function readConfig(env)
{
    const config = {
        token: env.VERCEL_TOKEN,
        edgeConfigId: env.EDGE_CONFIG_ID,
        teamId: env.VERCEL_TEAM_ID || undefined,
        metrics: env.QUICK_METRICS || '127.0.0.1:20241'
    };
    const missing = ['VERCEL_TOKEN', 'EDGE_CONFIG_ID'].filter((name) => !env[name]);
    if (missing.length) throw new Error(`Missing ${missing.join(' and ')}`);
    return config;
}

async function main()
{
    const config = readConfig(process.env);
    const stateFile = process.env.STATE_DIRECTORY
        ? path.join(process.env.STATE_DIRECTORY.split(':')[0], 'published-origin')
        : null;
    let lastPublished = stateFile ? (await readFile(stateFile, 'utf8').catch(() => '')).trim() : '';
    let lastResult = '';

    console.log(`Watching the tunnel at ${config.metrics}${lastPublished ? `; last published ${lastPublished}` : ''}`);
    for (;;) {
        const { result, origin, detail } = await publishIfChanged({ config, lastPublished });
        if (result === 'published') {
            lastPublished = origin;
            console.log(`Published ${origin}`);
            if (stateFile) await writeFile(stateFile, `${origin}\n`).catch((error) => console.error(error.message));
        } else if (result === 'failed') {
            console.error(detail);
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
