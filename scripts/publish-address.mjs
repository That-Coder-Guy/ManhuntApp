#!/usr/bin/env node
/**
 * Keeps a Vercel-hosted frontend pointed at this server.
 *
 * A Cloudflare quick tunnel gets a new https://….trycloudflare.com address
 * each time it starts. This watches the tunnel and, whenever its address
 * changes and answers, writes it to the Vercel project's Global Config, where
 * the app's /api/server-origin reads it. scripts/setup-server.sh installs it
 * as the manhunt-publish service; it only writes when the address changes.
 *
 * Environment:
 *   VERCEL_TOKEN     Vercel access token (Account Settings → Tokens)
 *   GLOBAL_CONFIG_ID The Global Config store's ID (ecfg_…)
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

// Ways to store the address, tried in order until one works. Vercel's current
// API is /global-config; /edge-config is the older name for the same stores.
// "upsert" creates or replaces the key, but if the API refuses it for a key
// that doesn't exist yet, "create" adds it.
export const WRITE_ATTEMPTS = [
    { api: 'global-config', operation: 'upsert' },
    { api: 'global-config', operation: 'create' },
    { api: 'edge-config', operation: 'upsert' },
    { api: 'edge-config', operation: 'create' }
];

/** The request that stores `origin` in Global Config. */
export function globalConfigRequest({ token, globalConfigId, teamId, origin }, attempt = WRITE_ATTEMPTS[0])
{
    const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    return {
        url: `https://api.vercel.com/v1/${attempt.api}/${encodeURIComponent(globalConfigId)}/items${query}`,
        init: {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ operation: attempt.operation, key: SERVER_ORIGIN_KEY, value: origin }] })
        }
    };
}

/**
 * Store `origin`, trying each way in turn. 'not found' or 'conflict' answers
 * move on to the next way; anything else (a refused token, say) stops.
 * `preferred` is the attempt that worked last time, tried first.
 */
export async function writeOrigin(config, origin, fetchImpl = fetch, preferred = null)
{
    const attempts = preferred ? [preferred, ...WRITE_ATTEMPTS.filter((a) => a !== preferred)] : WRITE_ATTEMPTS;
    const failures = [];
    for (const attempt of attempts) {
        const { url, init } = globalConfigRequest({ ...config, origin }, attempt);
        const response = await fetchImpl(url, { ...init, signal: timeout() });
        if (response.ok) return { ok: true, attempt };
        const body = (await response.text().catch(() => '')).slice(0, 160);
        failures.push({ attempt, status: response.status, body });
        if (![400, 404, 409].includes(response.status)) break;
    }
    return { ok: false, failures };
}

/** The teams this token can act for, as [{ id, slug }]; [] if it can't list them. */
export async function listTeams(token, fetchImpl = fetch)
{
    try {
        const response = await fetchImpl('https://api.vercel.com/v2/teams?limit=50', {
            headers: { Authorization: `Bearer ${token}` },
            signal: timeout()
        });
        if (!response.ok) return [];
        const { teams } = await response.json();
        return Array.isArray(teams) ? teams.filter((t) => typeof t?.id === 'string').map(({ id, slug }) => ({ id, slug })) : [];
    } catch {
        return [];
    }
}

/**
 * writeOrigin, and if no team was given (VERCEL_TEAM_ID) and Vercel refused or couldn't find
 * the store, try each of the token's teams: Vercel keeps most projects, even
 * personal ones, in a team, and the API only finds a team's store when the
 * request names that team. Sets config.teamId to the team that worked.
 */
export async function writeOriginFindingTeam(config, origin, fetchImpl = fetch, log = () => {})
{
    const written = await writeOrigin(config, origin, fetchImpl, config.preferredAttempt);
    const lastStatus = written.failures?.at(-1)?.status;
    if (written.ok || config.teamGiven || ![403, 404].includes(lastStatus)) return written;

    for (const team of await listTeams(config.token, fetchImpl)) {
        const inTeam = await writeOrigin({ ...config, teamId: team.id }, origin, fetchImpl, config.preferredAttempt);
        if (inTeam.ok) {
            config.teamId = team.id;
            log(`The store belongs to the team ${team.slug || team.id} (${team.id})`);
            return inTeam;
        }
    }
    return written;
}

function describeFailures(failures)
{
    const last = failures[failures.length - 1];
    const tried = failures.map((f) => `${f.attempt.api} ${f.attempt.operation} → ${f.status}`).join(', ');
    const hint = last.status === 401 || last.status === 403
        ? ' (check VERCEL_TOKEN, and that its scope includes the team that owns the store)'
        : failures.every((f) => f.status === 404) ? ' (check GLOBAL_CONFIG_ID, and VERCEL_TEAM_ID if the project is in a team)' : '';
    return `Vercel answered ${last.status}${hint}. Tried: ${tried}. Last reply: ${last.body}`;
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

    try {
        const written = await writeOriginFindingTeam(config, origin, fetchImpl, console.log);
        if (written.ok) {
            config.preferredAttempt = written.attempt; // skip straight to it next time
            return { result: 'published', origin };
        }
        return { result: 'failed', origin, detail: describeFailures(written.failures) };
    } catch (error) {
        return { result: 'failed', origin, detail: `Couldn't reach Vercel: ${error.message}` };
    }
}

function readConfig(env)
{
    const config = {
        token: env.VERCEL_TOKEN,
        globalConfigId: env.GLOBAL_CONFIG_ID,
        teamId: env.VERCEL_TEAM_ID || undefined,
        teamGiven: Boolean(env.VERCEL_TEAM_ID),
        metrics: env.QUICK_METRICS || '127.0.0.1:20241'
    };
    const missing = ['VERCEL_TOKEN', 'GLOBAL_CONFIG_ID'].filter((name) => !env[name]);
    if (missing.length) throw new Error(`Missing ${missing.join(' and ')}`);
    return config;
}

async function main()
{
    const config = readConfig(process.env);
    const stateDir = process.env.STATE_DIRECTORY?.split(':')[0];
    const stateFile = stateDir ? path.join(stateDir, 'published-origin') : null;
    const teamFile = stateDir ? path.join(stateDir, 'team-id') : null;
    let lastPublished = stateFile ? (await readFile(stateFile, 'utf8').catch(() => '')).trim() : '';
    // A team found on an earlier run, unless one was given
    if (!config.teamId && teamFile) config.teamId = (await readFile(teamFile, 'utf8').catch(() => '')).trim() || undefined;
    const savedTeam = config.teamId;
    let lastResult = '';

    console.log(`Watching the tunnel at ${config.metrics}${lastPublished ? `; last published ${lastPublished}` : ''}`);
    for (;;) {
        const { result, origin, detail } = await publishIfChanged({ config, lastPublished });
        if (result === 'published') {
            lastPublished = origin;
            console.log(`Published ${origin}`);
            if (stateFile) await writeFile(stateFile, `${origin}\n`).catch((error) => console.error(error.message));
            if (teamFile && config.teamId && !config.teamGiven && config.teamId !== savedTeam) {
                await writeFile(teamFile, `${config.teamId}\n`).catch((error) => console.error(error.message));
            }
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
