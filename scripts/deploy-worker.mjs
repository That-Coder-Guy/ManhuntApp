#!/usr/bin/env node
/**
 * Deploys cloudflare/worker.js to a free https://<name>.<you>.workers.dev
 * address through Cloudflare's API. scripts/setup-server.sh runs it; it can
 * also be run on its own to update the Worker.
 *
 * Environment:
 *   CLOUDFLARE_API_TOKEN  API token from the "Edit Cloudflare Workers" template
 *   PUBLISH_SECRET        Secret the Pi uses to tell the Worker its address
 *   WORKER_NAME           Worker name, the first part of the address (manhunt)
 *   WORKERS_SUBDOMAIN     Only if the account has no workers.dev subdomain yet:
 *                         the one to register (the <you> in the address)
 *   CF_ACCOUNT_ID         Only if the token can reach more than one account
 *
 * Prints the Worker's address on success; progress and errors go to stderr.
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';
const WORKER_FILE = new URL('../cloudflare/worker.js', import.meta.url);
const COMPATIBILITY_DATE = '2025-06-01';

/** A small Cloudflare API client; throws with Cloudflare's own error messages. */
export function cloudflare(token, fetchImpl = fetch)
{
    return async function call(method, path, body)
    {
        const init = { method, headers: { Authorization: `Bearer ${token}` } };
        if (body instanceof FormData) init.body = body;
        else if (body !== undefined) {
            init.body = JSON.stringify(body);
            init.headers['Content-Type'] = 'application/json';
        }
        const response = await fetchImpl(`${API}${path}`, init);
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
            const messages = (data?.errors || []).map((e) => `${e.message} (${e.code})`).join('; ');
            const error = new Error(`${method} ${path} → HTTP ${response.status}${messages ? `: ${messages}` : ''}`);
            error.status = response.status;
            error.codes = (data?.errors || []).map((e) => e.code);
            throw error;
        }
        return data.result;
    };
}

/** The multipart upload Cloudflare expects for an ES-module Worker. */
export function workerUpload(source, { namespaceId, secret })
{
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({
        main_module: 'worker.js',
        compatibility_date: COMPATIBILITY_DATE,
        bindings: [
            { type: 'kv_namespace', name: 'TUNNEL', namespace_id: namespaceId },
            { type: 'secret_text', name: 'PUBLISH_SECRET', text: secret }
        ]
    })], { type: 'application/json' }));
    form.append('worker.js', new Blob([source], { type: 'application/javascript+module' }), 'worker.js');
    return form;
}

async function pickAccount(call, wanted)
{
    const accounts = await call('GET', '/accounts?per_page=50');
    if (wanted) {
        const match = accounts.find((a) => a.id === wanted);
        if (!match) throw new Error(`The token can't reach account ${wanted}`);
        return match;
    }
    if (accounts.length === 1) return accounts[0];
    if (!accounts.length) throw new Error('The token can\'t reach any account. Create it from the "Edit Cloudflare Workers" template.');
    const list = accounts.map((a) => `${a.name} (${a.id})`).join(', ');
    throw new Error(`The token can reach several accounts; pick one with --cf-account: ${list}`);
}

async function workersSubdomain(call, accountId, wanted, log)
{
    let current = null;
    try {
        current = (await call('GET', `/accounts/${accountId}/workers/subdomain`))?.subdomain || null;
    } catch (error) {
        if (error.status !== 404) throw error; // 404: none registered yet
    }
    if (current) return current;
    if (!wanted) {
        throw new Error('This account has no workers.dev subdomain yet. Pick one (it becomes part of the address) '
            + 'and re-run with --workers-subdomain <name>, or choose it in the dashboard under Workers & Pages.');
    }
    log(`Registering ${wanted}.workers.dev for the account…`);
    return (await call('PUT', `/accounts/${accountId}/workers/subdomain`, { subdomain: wanted })).subdomain;
}

async function kvNamespace(call, accountId, title, log)
{
    const existing = await call('GET', `/accounts/${accountId}/storage/kv/namespaces?per_page=100`);
    const found = existing.find((n) => n.title === title);
    if (found) return found.id;
    log(`Creating the KV namespace ${title}…`);
    return (await call('POST', `/accounts/${accountId}/storage/kv/namespaces`, { title })).id;
}

/** Deploy and resolve with the Worker's https address. */
export async function deployWorker({ token, secret, name = 'manhunt', subdomain, accountId, source, fetchImpl = fetch, log = () => {} })
{
    if (!token) throw new Error('Missing CLOUDFLARE_API_TOKEN');
    if (!secret || secret.length < 32) throw new Error('PUBLISH_SECRET must be at least 32 characters');
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) throw new Error('The Worker name may only use a-z, 0-9 and -');

    const call = cloudflare(token, fetchImpl);
    const account = await pickAccount(call, accountId);
    log(`Account: ${account.name}`);
    const sub = await workersSubdomain(call, account.id, subdomain, log);
    const namespaceId = await kvNamespace(call, account.id, `${name}-tunnel`, log);

    log(`Uploading the Worker ${name}…`);
    await call('PUT', `/accounts/${account.id}/workers/scripts/${name}`, workerUpload(source, { namespaceId, secret }));
    await call('POST', `/accounts/${account.id}/workers/scripts/${name}/subdomain`, { enabled: true, previews_enabled: false });
    return `https://${name}.${sub}.workers.dev`;
}

async function main()
{
    const url = await deployWorker({
        token: process.env.CLOUDFLARE_API_TOKEN,
        secret: process.env.PUBLISH_SECRET,
        name: process.env.WORKER_NAME || 'manhunt',
        subdomain: process.env.WORKERS_SUBDOMAIN || undefined,
        accountId: process.env.CF_ACCOUNT_ID || undefined,
        source: await readFile(WORKER_FILE, 'utf8'),
        log: (line) => console.error(line)
    });
    console.log(url);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        if (error.status === 401 || error.status === 403) {
            console.error('Check the token: create it under My Profile → API Tokens from the "Edit Cloudflare Workers" template.');
        }
        process.exit(1);
    });
}
