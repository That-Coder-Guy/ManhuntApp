// The seeker's map turns with the phone, like the compass dial
import { BASE, SHOT, createLobby, join, startGame, makePlayer, passGate, hostKeyFor } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';
const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };

const SEEKER = { latitude: 39.19, longitude: -96.58 };
const EAST = { latitude: 39.19, longitude: -96.5782 };   // ~155 m due east
const id = await createLobby('Turning');

const ctx = await makePlayer(browser, SEEKER);
// An iPhone-style compass reporting window.__heading at 60 Hz
await ctx.addInitScript(() => {
  window.__heading = null;
  setInterval(() => {
    if (window.__heading === null) return;
    const e = new Event('deviceorientation');
    Object.defineProperty(e, 'webkitCompassHeading', { value: window.__heading });
    window.dispatchEvent(e);
  }, 16);
});
const page = await ctx.newPage();
await page.goto(BASE);
await page.evaluate(([lobby, key]) => localStorage.setItem(`manhunt_lobby_${lobby}`, JSON.stringify({ hostKey: key, timestamp: Date.now() })), [id, hostKeyFor(id)]);
await page.goto(`${BASE}/lobby/${id}`);
await passGate(page);
await page.locator('[data-testid="role-seeker"]').click();
const hider = await join(browser, id, EAST, { name: 'Eastwood' });
await startGame(page, hider.page);
await page.waitForSelector('[data-testid="target-card"]');
await page.waitForTimeout(1200);
await page.locator('[data-testid="target-card"]').first().click();
await page.locator('[data-testid="track-map-btn"]').click();
await page.waitForSelector('[data-testid="track-map"] .leaflet-tile-loaded');
await page.waitForTimeout(1200);

const rotation = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.track-map-wrap')).getPropertyValue('--map-rotation')) || 0);
const centre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const layout = () => page.evaluate(() => {
  const r = (el) => el && JSON.parse(JSON.stringify(el.getBoundingClientRect()));
  const you = [...document.querySelectorAll('.track-map path')].find((p) => p.getAttribute('fill') === '#ff7b2c');
  return { pin: r(document.querySelector('.track-pin--tracked .track-pin-disc')), label: r(document.querySelector('.track-pin-label')),
    you: r(you), wrap: r(document.querySelector('.track-map-wrap')), zoom: r(document.querySelector('.track-map .leaflet-control-zoom')) };
});
const relative = (l) => { const p = centre(l.pin), y = centre(l.you); return { dx: p.x - y.x, dy: p.y - y.y }; };

// No compass reading yet (as on a computer): north up, no north button
check(Math.abs(await rotation()) < 0.5 && await page.locator('[data-testid="track-map-north"]').count() === 0, 'without a compass: north up, no north button');
let rel = relative(await layout());
check(rel.dx > 40 && Math.abs(rel.dy) < 15, 'north up: the hider due east shows to the right', JSON.stringify(rel));

// Facing east: the map turns so east is up, smoothly
await page.evaluate(() => { window.__heading = 90; });
await page.waitForTimeout(1500);
check(Math.abs((await rotation()) + 90) < 1, `facing east: the map turns -90° (${(await rotation()).toFixed(1)}°)`);
let l = await layout();
rel = relative(l);
check(rel.dy < -40 && Math.abs(rel.dx) < 15, 'and the hider ahead of you shows above you', JSON.stringify(rel));
check(l.label.width > l.label.height * 2, 'the name stays upright', JSON.stringify(l.label));
check(l.zoom.x >= l.wrap.x && l.zoom.y >= l.wrap.y && l.zoom.width < l.zoom.height, 'zoom buttons upright, in the view', JSON.stringify(l.zoom));
// The turned map still covers the whole view: tiles in every corner
// (tiles ignore hit-testing, so: is every corner of the view inside the turned square?)
const corners = await page.evaluate(() => {
  const w = document.querySelector('.track-map-wrap').getBoundingClientRect();
  const m = document.querySelector('[data-testid="track-map"]');
  const side = m.offsetWidth;
  const angle = -parseFloat(getComputedStyle(document.querySelector('.track-map-wrap')).getPropertyValue('--map-rotation')) * Math.PI / 180;
  const cx = w.left + w.width / 2, cy = w.top + w.height / 2;
  return [[w.left, w.top], [w.right, w.top], [w.left, w.bottom], [w.right, w.bottom]].map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const u = dx * Math.cos(angle) - dy * Math.sin(angle), v = dx * Math.sin(angle) + dy * Math.cos(angle);
    return Math.abs(u) <= side / 2 && Math.abs(v) <= side / 2;
  });
});
check(corners.every(Boolean), 'the turned map covers every corner of the view', JSON.stringify(corners));
await page.screenshot({ path: `${SHOT}/maprotate-east.png` });

// Turning further: south-west
await page.evaluate(() => { window.__heading = 225; });
await page.waitForTimeout(1500);
check(Math.abs((await rotation()) + 225) < 1 || Math.abs((await rotation()) - 135) < 1, `facing south-west: turned to match (${(await rotation()).toFixed(1)}°)`);
await page.screenshot({ path: `${SHOT}/maprotate-sw.png` });

// Dragging moves the map with the finger, turned or not
await page.evaluate(() => { window.__heading = 90; });
await page.waitForTimeout(1500);
l = await layout();
const before = centre(l.pin);
const start = { x: l.wrap.x + l.wrap.width / 2, y: l.wrap.y + l.wrap.height * 0.7 };
await page.mouse.move(start.x, start.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(start.x + i * 8, start.y + i * 3);
await page.mouse.up();
await page.waitForTimeout(600);
const after = centre((await layout()).pin);
const moved = { dx: after.x - before.x, dy: after.y - before.y };
check(Math.abs(moved.dx - 80) < 12 && Math.abs(moved.dy - 30) < 12, 'a drag on the turned map moves it with the finger (80, 30)', JSON.stringify(moved));

// North button: keep north up, remembered
await page.locator('[data-testid="track-map-north"]').click();
await page.waitForTimeout(1500);
check(Math.abs(await rotation()) < 1 && await page.locator('[data-testid="track-map-north"]').getAttribute('aria-pressed') === 'true', 'the north button keeps north up');
await page.screenshot({ path: `${SHOT}/maprotate-north.png` });
check(await page.evaluate(() => localStorage.getItem('manhunt.mapNorthUp')) === '1', 'and is remembered');
await page.locator('[data-testid="track-map-north"]').click();
await page.waitForTimeout(1500);
check(Math.abs((await rotation()) + 90) < 1, 'tapping again turns it with you again');

// The compass view still works alongside
await page.locator('[data-testid="track-compass"]').click();
await page.waitForTimeout(800);
const rose = await page.evaluate(() => document.querySelector('.compass-rose')?.style.transform);
const roseAngle = ((parseFloat(/rotate\(([-\d.]+)deg/.exec(rose || '')?.[1]) % 360) + 360) % 360;
check(Math.abs(roseAngle - 270) < 1, 'the compass dial still turns too', rose);
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
