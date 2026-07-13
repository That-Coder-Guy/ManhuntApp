#!/usr/bin/env node
/**
 * One-command public tunnel:
 *   1. builds the frontend for single-origin (client talks to its own origin),
 *   2. starts the game server (serves dist/ + Socket.IO on PORT),
 *   3. launches `ngrok http PORT`,
 *   4. reads the public URL from ngrok's local API and prints it,
 *   5. tears everything down on Ctrl-C.
 *
 * Requires the ngrok CLI to be installed and authed (`ngrok config
 * add-authtoken <token>`). Override the port with PORT (default 3001).
 */

const { spawn, spawnSync } = require('child_process');
const net = require('net');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || '3001';
const NGROK_API = 'http://127.0.0.1:4040/api/tunnels';

const children = [];
let shuttingDown = false;

function shutdown(code = 0)
{
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
        if (child && !child.killed) {
            child.kill('SIGTERM');
        }
    }
    process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function run(command, args, opts = {})
{
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'inherit', ...opts });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`))));
    });
}

function waitForPort(port, timeoutMs = 20000)
{
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tryConnect = () => {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => { socket.destroy(); resolve(); });
            socket.once('error', () => {
                socket.destroy();
                if (Date.now() > deadline) {
                    reject(new Error(`Server did not open port ${port} in time`));
                } else {
                    setTimeout(tryConnect, 300);
                }
            });
        };
        tryConnect();
    });
}

function getJson(url)
{
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (err) { reject(err); }
            });
        }).on('error', reject);
    });
}

async function readPublicUrl(timeoutMs = 20000)
{
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const data = await getJson(NGROK_API);
            const tunnel = (data.tunnels || []).find((t) => t.public_url && t.public_url.startsWith('https'))
                || (data.tunnels || [])[0];
            if (tunnel && tunnel.public_url) return tunnel.public_url;
        } catch {
            // ngrok API not up yet
        }
        await new Promise((r) => setTimeout(r, 400));
    }
    return null;
}

function ngrokInstalled()
{
    const probe = spawnSync('ngrok', ['version'], { stdio: 'ignore' });
    return !probe.error;
}

async function main()
{
    if (!ngrokInstalled()) {
        console.error('\n✖ ngrok CLI not found on PATH.');
        console.error('  Install it from https://ngrok.com/download, then run:');
        console.error('    ngrok config add-authtoken <your-token>');
        console.error('  and try `npm run tunnel` again.\n');
        process.exit(1);
    }

    console.log('▸ Building frontend for single-origin serving…');
    await run('npm', ['run', 'build:selfhost'], { cwd: ROOT });

    console.log(`▸ Starting server on port ${PORT}…`);
    const server = spawn('node', ['server/server.js'], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, PORT }
    });
    children.push(server);
    server.on('exit', (code) => { if (!shuttingDown) shutdown(code || 0); });

    await waitForPort(Number(PORT));

    console.log('▸ Opening ngrok tunnel…');
    const ngrok = spawn('ngrok', ['http', String(PORT), '--log', 'stdout'], {
        cwd: ROOT,
        stdio: 'ignore',
        env: process.env
    });
    children.push(ngrok);
    ngrok.on('error', (err) => { console.error('ngrok failed to start:', err.message); shutdown(1); });
    ngrok.on('exit', (code) => { if (!shuttingDown) shutdown(code || 0); });

    const publicUrl = await readPublicUrl();
    if (publicUrl) {
        console.log('\n────────────────────────────────────────────────');
        console.log('  Manhunt is live on the open web:');
        console.log(`  ${publicUrl}`);
        console.log('  Open it on your phone, then share the in-app');
        console.log('  Invite QR / link with friends to join.');
        console.log('────────────────────────────────────────────────\n');
    } else {
        console.warn('\n⚠ Could not read the public URL from ngrok.');
        console.warn('  Check the ngrok dashboard at http://127.0.0.1:4040\n');
    }

    console.log('Press Ctrl-C to stop the tunnel and server.');
}

main().catch((err) => {
    console.error(err.message || err);
    shutdown(1);
});
