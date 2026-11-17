#!/usr/bin/env node
/**
 * Browser tests: the real app, played in headless Chromium against a real
 * game server.
 *
 *   npm run test:e2e                     every suite (pass/fail)
 *   npm run test:e2e -- found camera     just those suites
 *   npm run audit:ui                     the layout, legibility and text
 *                                        position audits (reports to read,
 *                                        not pass/fail)
 *
 * Builds the app first (npm run build:selfhost); pass --no-build to reuse
 * dist/. Starts the game server in this process on a free port, with a
 * stand-in push sender that records each notification to
 * tests/e2e/output/pushes.jsonl instead of sending it. Map tiles are stubbed,
 * so nothing here needs the internet. Screenshots land in tests/e2e/output/.
 *
 * Needs Playwright with Chromium (npm i -D playwright && npx playwright
 * install chromium). The notifications suite also needs the full Chromium
 * build (installed by that same command), as headless shell can't show
 * notifications.
 */

import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const OUT = path.join(HERE, 'output');
const PUSH_LOG = path.join(OUT, 'pushes.jsonl');
const SUITE_TIMEOUT_MS = 6 * 60 * 1000;

const args = process.argv.slice(2);
const audits = args.includes('--audits');
const folder = path.join(HERE, audits ? 'audits' : 'suites');
const available = readdirSync(folder).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, '')).sort();
const wanted = args.filter((a) => !a.startsWith('--'));
const unknown = wanted.filter((name) => !available.includes(name));
if (unknown.length)
{
    console.error(`No such ${audits ? 'audit' : 'suite'}: ${unknown.join(', ')}. There are: ${available.join(', ')}`);
    process.exit(1);
}
const toRun = wanted.length ? wanted : available;

// The app, built to be served by the game server itself
if (!args.includes('--no-build') || !existsSync(path.join(ROOT, 'dist', 'index.html')))
{
    console.log('▸ Building the app for single-origin serving…');
    const build = spawnSync('npm', ['run', 'build:selfhost'], { cwd: ROOT, stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status ?? 1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The game server, with pushes recorded rather than sent
const require = createRequire(import.meta.url);
const { createGameServer } = require('../../server/server.js');
const webpush = createRequire(path.join(ROOT, 'server', 'package.json'))('web-push');
const push = {
    // A real key, so phones' subscribe() accepts it
    publicKey: webpush.generateVAPIDKeys().publicKey,
    async send(subscription, payload, options)
    {
        appendFileSync(PUSH_LOG, `${JSON.stringify({ endpoint: subscription.endpoint, payload, options })}\n`);
        return { ok: true };
    }
};
const game = createGameServer({ distDir: path.join(ROOT, 'dist'), push });
await new Promise((resolve) => game.server.listen(0, '127.0.0.1', resolve));
const base = `http://localhost:${game.server.address().port}`;
console.log(`▸ Game server on ${base}\n`);

// Each suite in its own process (spawned, not spawnSync: the server runs here)
function runOne(name)
{
    return new Promise((resolve) =>
    {
        const child = spawn(process.execPath, [path.join(folder, `${name}.mjs`)], {
            cwd: HERE,
            stdio: 'inherit',
            env: { ...process.env, E2E_BASE: base, E2E_OUT: OUT, E2E_PUSH_LOG: PUSH_LOG }
        });
        const timer = setTimeout(() => { console.error(`✗ ${name} timed out`); child.kill('SIGKILL'); }, SUITE_TIMEOUT_MS);
        child.on('exit', (code) =>
        {
            clearTimeout(timer);
            resolve(code === 0);
        });
    });
}

const results = [];
for (const name of toRun)
{
    console.log(`━━ ${name}`);
    const started = Date.now();
    const passed = await runOne(name);
    results.push({ name, passed, seconds: Math.round((Date.now() - started) / 1000) });
    console.log('');
}

await game.close();
game.server.close();

if (audits)
{
    console.log(`Audits done (${results.map((r) => r.name).join(', ')}). Read the notes above; screenshots are in tests/e2e/output/.`);
    process.exit(0);
}
const failed = results.filter((r) => !r.passed);
console.log('━━ Summary');
for (const r of results) console.log(`${r.passed ? '✓' : '✗'} ${r.name} (${r.seconds} s)`);
console.log(failed.length ? `\n${failed.length} of ${results.length} suites failed` : `\nAll ${results.length} suites passed`);
process.exit(failed.length ? 1 : 0);
