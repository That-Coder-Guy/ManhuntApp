#!/usr/bin/env node
/**
 * Regenerates the README walkthrough images in docs/walkthrough/.
 *
 * Builds the app for single-origin serving, runs the real game server
 * in-process on a free port, then plays a scripted five-player game across
 * five browser "phones" (390×844 at 2×) and screenshots each step.
 *
 *   npm run build:selfhost is done for you; then:
 *   node scripts/capture-walkthrough.mjs
 *
 * Needs Playwright with Chromium (npm i -D playwright && npx playwright
 * install chromium). Map tiles come from OpenStreetMap; set STUB_TILES=1 to
 * draw a stand-in street map instead (for machines that can't reach it).
 * Pass --no-build to reuse an existing dist/.
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'walkthrough');
const require = createRequire(import.meta.url);

async function loadPlaywright()
{
    try { return await import('playwright'); } catch { /* try require, which honours NODE_PATH */ }
    try { return require('playwright'); } catch { /* not installed */ }
    console.error('Playwright is needed: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
}

const { chromium } = await loadPlaywright();
const { createGameServer } = require('../server/server.js');

if (!process.argv.includes('--no-build'))
{
    console.log('▸ Building the app for single-origin serving…');
    const build = spawnSync('npm', ['run', 'build:selfhost'], { cwd: ROOT, stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status ?? 1);
}

const game = createGameServer({ distDir: path.join(ROOT, 'dist') });
await new Promise((resolve) => game.server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${game.server.address().port}`;
console.log(`▸ App running at ${BASE}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = [];

async function shot(page, name)
{
    await pause(450); // let animations settle
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    console.log(`  ✓ ${name}`);
}

// ---- Stand-in map tiles (STUB_TILES=1): a procedural street grid drawn in
// world coordinates, so tiles join seamlessly at every zoom ----
let tileRenderer = null;
async function stubTile(z, x, y)
{
    tileRenderer ??= await browser.newPage();
    const dataUrl = await tileRenderer.evaluate(({ z, x, y }) =>
    {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const g = canvas.getContext('2d');
        const scale = 2 ** (z - 17);
        const pitch = 140 * scale;          // one city block at this zoom
        const ox = x * 256;
        const oy = y * 256;
        const hash = (a, b, c = 0) =>
        {
            let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2246822519);
            h = Math.imul(h ^ (h >>> 13), 1274126177);
            return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
        };
        g.fillStyle = '#f2efe9';
        g.fillRect(0, 0, 256, 256);

        const i0 = Math.floor(ox / pitch) - 1;
        const j0 = Math.floor(oy / pitch) - 1;
        const i1 = Math.floor((ox + 256) / pitch) + 1;
        const j1 = Math.floor((oy + 256) / pitch) + 1;
        const road = (i) => Math.max(1.5, (i % 4 === 0 ? 16 : 9) * scale);

        for (let i = i0; i <= i1; i++)
        {
            for (let j = j0; j <= j1; j++)
            {
                const left = i * pitch - ox + road(i) / 2;
                const top = j * pitch - oy + road(j) / 2;
                const w = pitch - road(i) / 2 - road(i + 1) / 2;
                const h = pitch - road(j) / 2 - road(j + 1) / 2;
                const kind = hash(i, j);
                if (kind < 0.14)
                {
                    g.fillStyle = '#cde6c0';           // park
                    g.fillRect(left, top, w, h);
                    g.fillStyle = '#b5d7a5';
                    for (let t = 0; t < 7; t++)
                    {
                        g.beginPath();
                        g.arc(left + hash(i, j, t) * w, top + hash(j, i, t) * h, 5 * scale + 1, 0, Math.PI * 2);
                        g.fill();
                    }
                }
                else
                {
                    const count = 2 + Math.floor(hash(i, j, 9) * 4);
                    for (let b = 0; b < count; b++)
                    {
                        const bw = w * (0.22 + hash(i, j, b * 3) * 0.3);
                        const bh = h * (0.2 + hash(i, j, b * 3 + 1) * 0.3);
                        const bx = left + 4 * scale + hash(i, j, b * 3 + 2) * (w - bw - 8 * scale);
                        const by = top + 4 * scale + hash(j, i, b * 5) * (h - bh - 8 * scale);
                        g.fillStyle = '#e1dbd1';
                        g.strokeStyle = '#d2cbbf';
                        g.lineWidth = 1;
                        g.fillRect(bx, by, bw, bh);
                        g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
                    }
                }
            }
        }
        // Streets on top: white with a soft edge, avenues every fourth line
        for (let i = i0; i <= i1; i++)
        {
            const px = i * pitch - ox;
            g.fillStyle = '#d9d3c8';
            g.fillRect(px - road(i) / 2 - 1, 0, road(i) + 2, 256);
            g.fillStyle = i % 4 === 0 ? '#fdf3d8' : '#ffffff';
            g.fillRect(px - road(i) / 2, 0, road(i), 256);
        }
        for (let j = j0; j <= j1; j++)
        {
            const py = j * pitch - oy;
            g.fillStyle = '#d9d3c8';
            g.fillRect(0, py - road(j) / 2 - 1, 256, road(j) + 2);
            g.fillStyle = j % 4 === 0 ? '#fdf3d8' : '#ffffff';
            g.fillRect(0, py - road(j) / 2, 256, road(j));
        }
        return canvas.toDataURL('image/png');
    }, { z, x, y });
    return Buffer.from(dataUrl.split(',')[1], 'base64');
}

// ---- Portrait-like stand-in profile photos ----
async function portrait({ bg, skin, hair, shirt })
{
    const page = await browser.newPage({ viewport: { width: 300, height: 300 } });
    await page.setContent(`<body style="margin:0"><div style="width:300px;height:300px;position:relative;overflow:hidden;
        background:radial-gradient(circle at 30% 20%, ${bg[0]}, ${bg[1]})">
      <div style="position:absolute;left:62px;top:196px;width:176px;height:150px;border-radius:88px 88px 0 0;background:${shirt}"></div>
      <div style="position:absolute;left:126px;top:150px;width:48px;height:60px;background:${skin};border-radius:12px"></div>
      <div style="position:absolute;left:96px;top:62px;width:108px;height:128px;border-radius:54px;background:${skin}"></div>
      <div style="position:absolute;left:90px;top:50px;width:120px;height:62px;border-radius:60px 60px 22px 22px;background:${hair}"></div>
    </div></body>`);
    const buffer = await page.screenshot({ type: 'png' });
    await page.close();
    return { name: 'photo.png', mimeType: 'image/png', buffer };
}

// ---- Players ----
const PARK = { latitude: 39.1912, longitude: -96.5805 };
const at = (dLat, dLon) => ({ latitude: PARK.latitude + dLat, longitude: PARK.longitude + dLon });
const players = [];

async function move(player, location)
{
    player.location = location;
    await player.context.setGeolocation(location);
}

// Real phones report a slightly different fix every few seconds; emulated
// ones report once and go quiet, which would show everyone as stale
function startGpsJitter()
{
    return setInterval(() =>
    {
        for (const p of players)
        {
            const wobble = () => (Math.random() - 0.5) * 0.00002;
            p.context.setGeolocation({ latitude: p.location.latitude + wobble(), longitude: p.location.longitude + wobble() }).catch(() => {});
        }
    }, 2500);
}

async function phone(location, { hostKey, lobbyId, reducedMotion } = {})
{
    const context = await browser.newContext({ ...PHONE, geolocation: location, permissions: ['geolocation'], reducedMotion });
    if (process.env.STUB_TILES)
    {
        await context.route('https://tile.openstreetmap.org/**', async (route) =>
        {
            const [z, x, y] = new URL(route.request().url()).pathname.replace('.png', '').split('/').filter(Boolean).map(Number);
            await route.fulfill({ status: 200, contentType: 'image/png', body: await stubTile(z, x, y) });
        });
    }
    await context.addInitScript(() =>
    {
        Object.defineProperty(navigator, 'wakeLock', {
            value: { request: async () => ({ addEventListener() {}, release: async () => {} }) }
        });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
        // Desktop Chromium exposes iOS's motion permission gate; phones that matter don't
        if (window.DeviceOrientationEvent) Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { value: undefined });
    });
    const page = await context.newPage();
    if (lobbyId !== undefined || hostKey) players.push({ context, page, location });
    if (hostKey)
    {
        await page.goto(BASE);
        await page.evaluate(([id, key]) => localStorage.setItem(`manhunt_lobby_${id}`, JSON.stringify({ hostKey: key, timestamp: Date.now() })), [lobbyId, hostKey]);
    }
    return { context, page };
}

async function enterLobby(page, lobbyId, { stopAtGate = false } = {})
{
    await page.goto(`${BASE}/lobby/${lobbyId}`);
    await page.waitForSelector('[data-testid="toggle-location"]');
    if (stopAtGate) return;
    await passGate(page);
}

async function passGate(page)
{
    await page.waitForSelector('[data-testid="gate-continue"]:not(.button-disabled)');
    await page.locator('[data-testid="gate-continue"]').click();
    await page.waitForSelector('[data-testid="toggle-location"]', { state: 'hidden' });
    await pause(300);
}

async function setUp(page, { name, seeker = false, photo = null })
{
    await page.locator('[data-testid="name-input"] input').fill(name);
    await page.locator('[data-testid="name-save"]').click();
    await page.waitForSelector('[data-testid="name-save"]', { state: 'detached' });
    if (photo) await page.locator('[data-testid="avatar-input"]').setInputFiles(photo);
    if (seeker) await page.locator('[data-testid="role-seeker"]').click();
    await pause(200);
}

function setSelect(page, testId, value)
{
    return page.evaluate(([id, v]) =>
    {
        const el = document.querySelector(`[data-testid="${id}"]`);
        el.value = v;
        el.dispatchEvent(new CustomEvent('ionChange', { detail: { value: v }, bubbles: true }));
    }, [testId, value]);
}

let jitter = null;
try {
    // 1. Home
    {
        const { context, page } = await phone(PARK);
        await page.goto(BASE);
        await page.waitForSelector('[data-testid="create-btn"]');
        await page.locator('[data-testid="create-name-input"] input').fill('Riverside Park');
        await shot(page, '01-home');
        await context.close();
    }

    const created = await (await fetch(`${BASE}/manhunt-api/create-lobby`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lobby_name: 'Riverside Park' })
    })).json();
    const lobbyId = created.lobby_id;

    // 2. The host arrives: permissions, then profile
    const maya = await phone(PARK, { hostKey: created.host_key, lobbyId });
    await enterLobby(maya.page, lobbyId, { stopAtGate: true });
    await pause(500);
    await shot(maya.page, '02-permissions');
    await passGate(maya.page);
    await setUp(maya.page, { name: 'Maya', photo: await portrait({ bg: ['#7f9bb3', '#2f4458'], skin: '#d8a888', hair: '#3a2418', shirt: '#c06a3a' }) });

    // 3. Friends join from the invite
    const theo = await phone(at(0.0005, 0.0002), { lobbyId });
    await enterLobby(theo.page, lobbyId);
    await setUp(theo.page, { name: 'Theo', seeker: true, photo: await portrait({ bg: ['#9fb38a', '#3e5232'], skin: '#8d5a3c', hair: '#151515', shirt: '#3c6e8f' }) });
    const jordan = await phone(at(-0.0008, 0.0011), { lobbyId });
    await enterLobby(jordan.page, lobbyId);
    await setUp(jordan.page, { name: 'Jordan', seeker: true });
    const priya = await phone(at(0.0011, -0.0014), { lobbyId });
    await enterLobby(priya.page, lobbyId);
    await setUp(priya.page, { name: 'Priya', photo: await portrait({ bg: ['#b39a8a', '#523c32'], skin: '#b07a55', hair: '#20120c', shirt: '#6b8f4e' }) });
    const sam = await phone(at(-0.0007, -0.0004), { lobbyId });
    await enterLobby(sam.page, lobbyId);
    await setUp(sam.page, { name: 'Sam Okafor' });

    // 4. The host draws the play area and sets the clock
    await maya.page.locator('[data-testid="settings-row"]').click();
    await maya.page.waitForSelector('[data-testid="fence-toggle"]');
    await pause(400);
    await maya.page.locator('[data-testid="fence-toggle"]').click();
    await maya.page.waitForSelector('[data-testid="play-area-map"] .leaflet-tile-loaded', { timeout: 15000 });
    await maya.page.locator('[data-testid="play-area-map"] .leaflet-control-zoom-out').click();
    await pause(700);
    const map = await maya.page.locator('[data-testid="play-area-map"]').boundingBox();
    const cx = map.x + map.width / 2;
    const cy = map.y + map.height / 2;
    for (const [dx, dy] of [[-120, -100], [20, -122], [128, -70], [118, 78], [-10, 120], [-128, 52]])
    {
        await maya.page.mouse.click(cx + dx, cy + dy);
        await pause(180);
    }
    await setSelect(maya.page, 'time-limit', 30);
    await setSelect(maya.page, 'head-start', 30);
    await maya.page.locator('ion-content.settings-content').evaluate((el) => el.scrollToTop?.());
    await shot(maya.page, '04-play-area');
    await maya.page.locator('[data-testid="settings-save"]').click();
    await maya.page.waitForSelector('[data-testid="settings-sheet"]', { state: 'hidden' }).catch(() => {});
    await pause(900);

    // 5. Lobby from both sides, the invite and the host's player menu
    await shot(maya.page, '03-lobby-host');
    await shot(theo.page, '05-lobby-guest');
    await maya.page.locator('[data-testid="invite-btn"]').click();
    await maya.page.waitForSelector('[data-testid="share-qr-img"]');
    await shot(maya.page, '06-invite');
    await maya.page.locator('[data-testid="share-close"]').click();
    await pause(600);
    await maya.page.locator('[data-testid="lobby-player"]', { hasText: 'Sam Okafor' }).locator('[data-testid="player-menu"]').click();
    await maya.page.waitForSelector('ion-action-sheet.player-actions:not(.overlay-hidden)');
    await shot(maya.page, '07-player-menu');
    await maya.page.locator('ion-action-sheet.player-actions button:has-text("Cancel")').click();
    await pause(500);

    // 6. Start: seekers wait out the head start
    await maya.page.locator('[data-testid="start-game"]').click();
    for (const p of [maya, theo, jordan, priya, sam]) await p.page.waitForSelector('[data-phase="playing"]');
    jitter = startGpsJitter();
    await pause(4000);
    await shot(theo.page, '08-head-start');
    console.log('  … waiting out the 30 s head start');
    await theo.page.waitForFunction(() => /m$/.test(document.querySelector('[data-testid="target-distance"]')?.innerText || ''), null, { timeout: 45000 });

    // 7. The hunt: Sam strays outside, Theo closes in on Maya
    await move(players.find((p) => p.page === sam.page), at(-0.0042, -0.0009));
    await move(players.find((p) => p.page === theo.page), at(0.0004, 0.0003));
    await pause(5000);
    await shot(theo.page, '09-seeker');
    await theo.page.locator('[data-testid="target-card"]', { hasText: 'Priya' }).click();
    await theo.page.evaluate(() =>
    {
        for (let i = 0; i < 40; i++)
        {
            window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 15, beta: 20, gamma: 0, absolute: true }));
        }
    });
    await shot(theo.page, '10-compass');
    await shot(maya.page, '11-hider');
    await sam.page.waitForSelector('[data-testid="out-of-bounds"]');
    await shot(sam.page, '12-outside');
    await sam.page.locator('[data-testid="game-status"]').click();
    await sam.page.waitForSelector('[data-testid="play-area-map"] .leaflet-tile-loaded', { timeout: 15000 });
    await pause(800);
    await shot(sam.page, '13-area-map');

    // 8. Signal drops: last known positions stay, clearly labelled
    await jordan.context.setOffline(true);
    await jordan.page.evaluate(() => window.__manhuntSocket?.io?.engine?.close());
    await jordan.page.waitForSelector('[data-testid="offline-banner"]');
    await pause(6000);
    await shot(jordan.page, '14-offline');
    await jordan.context.setOffline(false);

    // 9. The host ends the round
    await maya.page.locator('[data-testid="end-game-btn"]').click();
    await maya.page.waitForSelector('.end-alert');
    await maya.page.locator('.end-alert button:has-text("End game")').click();
    await maya.page.waitForSelector('[data-phase="ended"]');
    await shot(maya.page, '15-game-over');

    // Hero: three phones side by side
    const hero = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const { readFileSync } = await import('node:fs');
    const img = (n) => `data:image/png;base64,${readFileSync(path.join(OUT, `${n}.png`)).toString('base64')}`;
    await hero.setContent(`<body style="margin:0;background:#07080d">
      <div style="display:flex;gap:48px;justify-content:center;align-items:center;height:1000px">
        ${['03-lobby-host', '10-compass', '11-hider'].map((n, i) => `
          <img src="${img(n)}" style="width:390px;height:844px;border-radius:44px;
            outline:1px solid rgba(238,240,245,0.12);outline-offset:8px;
            ${i === 1 ? 'transform:translateY(-24px)' : 'transform:translateY(24px)'}">`).join('')}
      </div></body>`);
    await hero.waitForLoadState('load');
    await hero.screenshot({ path: path.join(OUT, 'hero.png') });
    console.log('  ✓ hero');
} finally {
    clearInterval(jitter);
    await browser.close();
    await game.close();
}

console.log(`\nSaved ${shots.length + 1} images to ${path.relative(ROOT, OUT)}/`);
