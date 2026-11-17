// Shared helpers for the browser tests (tests/e2e/run.mjs starts the server
// and sets E2E_BASE / E2E_OUT for every suite)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = process.env.E2E_BASE || 'http://localhost:3101';
// Screenshots and other output (gitignored)
export const SHOT = process.env.E2E_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'output');
mkdirSync(SHOT, { recursive: true });

// Stand-in map tiles: OpenStreetMap is unreachable from this sandbox, so
// serve a light street-like tile (the app night-tints it like real tiles)
let tileBuffer = null;
async function stubTile(browser) {
  if (tileBuffer) return tileBuffer;
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  await page.setContent(`<div style="width:256px;height:256px;background:#f2efe9;position:relative;overflow:hidden">
    <div style="position:absolute;left:0;right:0;top:118px;height:14px;background:#fff;border-top:1px solid #d6d2ca;border-bottom:1px solid #d6d2ca"></div>
    <div style="position:absolute;top:0;bottom:0;left:60px;width:10px;background:#fff;border-left:1px solid #d6d2ca;border-right:1px solid #d6d2ca"></div>
    <div style="position:absolute;left:150px;top:20px;width:80px;height:70px;background:#cfe6c4"></div>
    <div style="position:absolute;left:96px;top:160px;width:60px;height:46px;background:#e0dcd3"></div></div>`);
  tileBuffer = await page.screenshot({ type: 'png' });
  await page.close();
  return tileBuffer;
}

export async function makePlayer(browser, coords, opts = {}) {
  const tile = await stubTile(browser);
  const context = await browser.newContext({
    geolocation: coords,
    permissions: ['geolocation'],
    viewport: opts.viewport || { width: 390, height: 844 },
    ...opts
  });
  await context.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: tile }));
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: async () => ({ addEventListener() {}, release: async () => {} }) }
    });
    // Desktop Chromium exposes the iOS-style permission gate; drop it so the
    // compass listens immediately like Android does
    if (window.DeviceOrientationEvent) {
      Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { value: undefined, configurable: true });
    }
    window.__clip = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t) => { window.__clip = t; } }
    });
  });
  return context;
}

// "Before you play" (browser only): allow location, then Continue
export async function passGate(page) {
  await page.waitForSelector('[data-testid="toggle-location"], [data-testid="lobby-page"]', { timeout: 10000 });
  const gate = await page.waitForSelector('[data-testid="gate-continue"]', { timeout: 4000 }).catch(() => null);
  if (gate) {
    const loc = page.locator('[data-testid="toggle-location"]');
    if (await loc.getAttribute('aria-disabled') !== 'true') await loc.click();
    await page.waitForSelector('[data-testid="gate-continue"]:not(.button-disabled)', { timeout: 10000 });
    await page.locator('[data-testid="gate-continue"]').click();
    await page.waitForSelector('[data-testid="gate-continue"]', { state: 'hidden', timeout: 6000 }).catch(() => {});
  }
  await page.waitForTimeout(350);
}

// Returns the lobby ID; the host key is remembered for joinAsHost
const hostKeys = new Map();
export async function createLobby(name) {
  const res = await fetch(`${BASE}/manhunt-api/create-lobby`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lobby_name: name })
  });
  const body = await res.json();
  hostKeys.set(body.lobby_id, body.host_key);
  return body.lobby_id;
}
export const hostKeyFor = (id) => hostKeys.get(id);

export async function rename(page, name) {
  await page.locator('[data-testid="name-input"] input').fill(name);
  await page.locator('[data-testid="name-save"]').click();
  await page.waitForSelector('[data-testid="name-save"]', { state: 'detached', timeout: 5000 }).catch(() => {});
}

// Join a player into a lobby, optionally rename and set role
export async function join(browser, id, coords, { name, seeker = false, viewport, host = false, extra = {} } = {}) {
  const ctx = await makePlayer(browser, coords, { ...(viewport ? { viewport } : {}), ...extra });
  const page = await ctx.newPage();
  if (host) {
    // What Home does after creating a lobby: keep the host key with the session
    await page.goto(BASE);
    await page.evaluate(([lobby, key]) => localStorage.setItem(`manhunt_lobby_${lobby}`,
      JSON.stringify({ hostKey: key, timestamp: Date.now() })), [id, hostKeys.get(id)]);
  }
  await page.goto(`${BASE}/lobby/${id}`);
  await passGate(page);
  if (name) await rename(page, name);
  if (seeker) await page.locator('[data-testid="role-seeker"]').click();
  return { ctx, page };
}

// Host starts the game and everyone given waits for the playing phase
export async function startGame(hostPage, ...others) {
  await hostPage.locator('[data-testid="start-game"]').click();
  for (const p of [hostPage, ...others]) await p.waitForSelector('[data-phase="playing"]', { timeout: 8000 });
}

// A fake photo: render something photo-like and screenshot it as a PNG
export async function fakePhoto(browser, hue = 20) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.setContent(`<div style="width:400px;height:300px;background:
    radial-gradient(circle at 50% 38%, hsl(${hue} 45% 72%) 0 18%, transparent 19%),
    radial-gradient(ellipse at 50% 95%, hsl(${hue + 180} 30% 38%) 0 42%, transparent 43%),
    linear-gradient(160deg, hsl(${hue + 40} 25% 55%), hsl(${hue + 200} 30% 22%))"></div>`);
  const buffer = await page.screenshot({ type: 'png' });
  await page.close();
  return { name: 'photo.png', mimeType: 'image/png', buffer };
}
