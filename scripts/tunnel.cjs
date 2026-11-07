#!/usr/bin/env node
/**
 * One command to put the app on the open web through Cloudflare Tunnel
 * (free, no bandwidth cap for an app like this, WebSockets supported, and no
 * router port forwarding):
 *   1. builds the frontend for single-origin (it talks to its own origin),
 *   2. starts the game server (serves dist/ + Socket.IO on PORT),
 *   3. starts cloudflared and prints the public HTTPS URL,
 *   4. tears everything down on Ctrl-C.
 *
 * Two modes:
 *   - Quick tunnel (default, no account): a random https://*.trycloudflare.com
 *     URL that changes every run. Good for a one-off game.
 *   - Named tunnel: set TUNNEL_TOKEN (from the Cloudflare dashboard) to serve
 *     on your own fixed hostname. Set PUBLIC_URL to have it printed.
 *
 * Requires the cloudflared CLI on PATH. Override the port with PORT (3001).
 */

const { spawn, spawnSync } = require('child_process');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || '3001';
const TOKEN = process.env.TUNNEL_TOKEN;
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const URL_WAIT_MS = 30000;

const children = [];
let shuttingDown = false;

function shutdown(code = 0)
{
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
        if (child.exitCode === null) child.kill('SIGTERM');
    }
    process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function run(command, args)
{
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`))));
    });
}

// Start a long-running child; if it dies, everything stops
function startChild(name, command, args, options)
{
    const child = spawn(command, args, { cwd: ROOT, ...options });
    children.push(child);
    child.on('error', (err) => { console.error(`${name} failed to start: ${err.message}`); shutdown(1); });
    child.on('exit', (code) => { if (!shuttingDown) { console.error(`${name} stopped (code ${code})`); shutdown(code || 1); } });
    return child;
}

function waitForPort(port, timeoutMs = 20000)
{
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const attempt = () => {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => { socket.destroy(); resolve(); });
            socket.once('error', () => {
                socket.destroy();
                if (Date.now() > deadline) reject(new Error(`Server did not open port ${port} in time`));
                else setTimeout(attempt, 300);
            });
        };
        attempt();
    });
}

// cloudflared logs the quick-tunnel URL (to stderr); watch both streams for it
function waitForQuickTunnelUrl(child)
{
    return new Promise((resolve) => {
        let found = false;
        const timer = setTimeout(() => resolve(null), URL_WAIT_MS);
        const scan = (chunk) => {
            const match = !found && QUICK_TUNNEL_URL.exec(chunk.toString());
            if (match) { found = true; clearTimeout(timer); resolve(match[0]); }
        };
        child.stdout.on('data', scan);
        child.stderr.on('data', scan);
    });
}

function banner(lines)
{
    const rule = '─'.repeat(52);
    console.log(`\n${rule}\n${lines.map((l) => `  ${l}`).join('\n')}\n${rule}\n`);
}

async function main()
{
    if (spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).error) {
        console.error('\n✖ cloudflared not found on PATH.');
        console.error('  Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
        console.error('  (Raspberry Pi: see "Host on a Raspberry Pi" in the README.)\n');
        process.exit(1);
    }

    console.log('▸ Building frontend for single-origin serving…');
    await run('npm', ['run', 'build:selfhost']);

    console.log(`▸ Starting server on port ${PORT}…`);
    startChild('Server', 'node', ['server/server.js'], { stdio: 'inherit', env: { ...process.env, PORT } });
    await waitForPort(Number(PORT));

    if (TOKEN) {
        // Named tunnel: the hostname → http://localhost:PORT route lives in the
        // Cloudflare dashboard; cloudflared reads the token from TUNNEL_TOKEN
        console.log('▸ Connecting your named Cloudflare tunnel…');
        startChild('cloudflared', 'cloudflared', ['tunnel', '--no-autoupdate', 'run'], { stdio: 'inherit', env: process.env });
        banner(['Manhunt is live on your tunnel hostname', process.env.PUBLIC_URL || '(the one set in the Cloudflare dashboard)']);
    } else {
        console.log('▸ Opening a Cloudflare quick tunnel…');
        const tunnel = startChild('cloudflared', 'cloudflared',
            ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`],
            { stdio: ['ignore', 'pipe', 'pipe'] });
        const url = await waitForQuickTunnelUrl(tunnel);
        if (url) {
            banner(['Manhunt is live on the open web:', url, 'Open it on your phone, then share the in-app', 'Invite QR / link with friends to join.']);
        } else {
            console.warn('\n⚠ cloudflared started but no tunnel URL appeared yet. Check your connection.\n');
        }
    }

    console.log('Press Ctrl-C to stop the tunnel and server.');
}

main().catch((err) => {
    console.error(err.message || err);
    shutdown(1);
});
