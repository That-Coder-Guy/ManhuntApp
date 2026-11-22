#!/usr/bin/env node
/**
 * The simulator: up to four phones side by side in one browser window, each
 * running the real web app against a real game server on this computer. A
 * game is set up and started by itself, and every phone walks about at
 * random.
 *
 *   npm run simulate                 build the app, start, open the browser
 *   npm run simulate -- --no-build   reuse dist/ as it is
 *   npm run simulate -- --no-open    don't open the browser
 *   npm run simulate -- --port 4000  another port (default 3210)
 *
 * The game server runs in this process with notifications off, and listens
 * on this computer only. The app itself is not changed: every page it serves
 * gets one extra script (scripts/simulator/phone.mjs), which does nothing
 * unless the page is one of the simulator's phones. There it stands in for
 * the phone's location and compass, keeps each phone's saved data apart
 * (they share one browser), and joins and starts the game.
 */

import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const PAGES = path.join(HERE, 'simulator');
const DEFAULT_PORT = 3210;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const portArg = args.indexOf('--port');
const wantedPort = portArg === -1 ? DEFAULT_PORT : Number(args[portArg + 1]);
if (!Number.isInteger(wantedPort) || wantedPort < 0 || wantedPort > 65535)
{
    console.error('--port needs a number, for example --port 4000');
    process.exit(1);
}

// The app, built to talk to the server that serves it
if (!flag('--no-build') || !existsSync(path.join(DIST, 'index.html')))
{
    console.log('▸ Building the app…');
    const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, VITE_API_ORIGIN: '' }
    });
    if (build.status !== 0) process.exit(build.status ?? 1);
}

const require = createRequire(import.meta.url);
const { createGameServer } = require('../server/server.js');
const express = createRequire(path.join(ROOT, 'server', 'package.json'))('express');

// No dist for the game server: the app is served below, with the phone script added
const game = createGameServer({ distDir: null, push: null });
const { app, server } = game;

const PHONE_SCRIPT = '<script src="/simulator/phone.mjs"></script>';
// Read each time, so a rebuild while this runs is picked up on the next load
const appPage = () => readFileSync(path.join(DIST, 'index.html'), 'utf8').replace('<head>', `<head>\n    ${PHONE_SCRIPT}`);

app.get('/simulator', (req, res) => res.sendFile(path.join(PAGES, 'page.html')));
// The bare address in a tab of its own means the simulator; in a phone's frame it's the app's first page
app.get('/', (req, res, next) => (req.get('Sec-Fetch-Dest') === 'document' ? res.redirect('/simulator') : next()));
app.use('/simulator', express.static(PAGES, { index: false }));
// No service worker here: it would serve the app's page from its cache, without the phone script
app.get('/sw.js', (req, res) => res.status(404).end());
app.use(express.static(DIST, { index: false }));
app.get(/^\/(?!manhunt-api).*/, (req, res) => res.type('html').set('Cache-Control', 'no-store').send(appPage()));

function listen(port)
{
    return new Promise((resolve, reject) =>
    {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () =>
        {
            server.off('error', reject);
            resolve();
        });
    });
}

try {
    await listen(wantedPort);
} catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    console.log(`▸ Port ${wantedPort} is in use; taking a free one`);
    await listen(0);
}

const address = `http://localhost:${server.address().port}/simulator`;
console.log(`\n  Manhunt simulator: ${address}\n  Ctrl-C stops it.\n`);

if (!flag('--no-open'))
{
    const [command, commandArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', address]]
        : process.platform === 'darwin' ? ['open', [address]]
        : ['xdg-open', [address]];
    // Best effort: the address is printed above either way
    spawn(command, commandArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

for (const signal of ['SIGINT', 'SIGTERM'])
{
    process.on(signal, () => game.close().finally(() => process.exit(0)));
}
