// The optional camera switch: in the installed app's popup and Settings, not in "Before you play"
import { BASE, SHOT, makePlayer, createLobby } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';
const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const isOn = (page, id) => page.locator(`[data-testid="toggle-${id}"]`).evaluate((t) => t.checked);
const cameraStub = () => {
  window.__camera = { opened: 0, stopped: 0 };
  let allowed = localStorage.getItem('__cam') === '1';
  const q = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (d) => (d.name === 'camera' ? Promise.resolve({ state: allowed ? 'granted' : 'prompt', onchange: null }) : q(d));
  navigator.mediaDevices.getUserMedia = async () => {
    window.__camera.opened++; allowed = true; localStorage.setItem('__cam', '1');
    return { getTracks: () => [{ stop: () => { window.__camera.stopped++; } }] };
  };
};

// Installed app, first open
const ctx = await makePlayer(browser, { latitude: 39.19, longitude: -96.58 });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
await ctx.addInitScript(cameraStub);
const page = await ctx.newPage();
await page.goto(BASE);
await page.waitForSelector('[data-testid="toggle-camera"]');
const rows = await page.$$eval('ion-list.permission-list ion-item h3', (hs) => hs.map((h) => h.innerText.replace(/\s+/g, ' ')));
check(JSON.stringify(rows) === JSON.stringify(['Location Required', 'Notifications Optional', 'Camera Optional', 'Keep screen on Optional']), 'popup: camera listed as optional, after the required ones', rows.join(' | '));
check(!(await isOn(page, 'camera')) && (await page.evaluate(() => window.__camera.opened)) === 0, 'nothing asked until tapped');
check(!(await page.locator('[data-testid="setup-done"]').evaluate((b) => b.classList.contains('button-disabled'))), 'and it never blocks Done');
await page.locator('[data-testid="toggle-camera"]').click();
await page.waitForTimeout(500);
const cam = await page.evaluate(() => window.__camera);
check(await isOn(page, 'camera') && cam.opened === 1 && cam.stopped === 1, 'tapping it asks once, and the camera is closed again straight away', JSON.stringify(cam));
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOT}/camera-setup.png` });
await page.locator('[data-testid="setup-done"]').click();
await page.goto(`${BASE}/settings`);
await page.waitForSelector('[data-testid="toggle-camera"]');
await page.waitForTimeout(300);
check(await isOn(page, 'camera'), 'Settings shows it, already on');
// Optional, so it turns off, and back on without asking again
await page.locator('[data-testid="toggle-camera"]').click();
await page.waitForTimeout(400);
check(!(await isOn(page, 'camera')) && await page.locator('[data-testid="camera-status"]').count() === 0
  && await page.locator('[data-testid="toggle-camera"]').getAttribute('aria-disabled') !== 'true', 'it turns off (and stays switchable)');
await page.reload();
await page.waitForSelector('[data-testid="toggle-camera"]');
await page.waitForTimeout(300);
check(!(await isOn(page, 'camera')), 'off is remembered');
await page.locator('[data-testid="toggle-camera"]').click();
await page.waitForTimeout(400);
check(await isOn(page, 'camera') && (await page.evaluate(() => window.__camera.opened)) === 0, 'and back on without asking again');
await ctx.close();

// Browser "Before you play": no camera row (the lobby doesn't scan codes)
const b = await makePlayer(browser, { latitude: 39.19, longitude: -96.58 });
const bp = await b.newPage();
await bp.goto(`${BASE}/lobby/${await createLobby('Cam')}`);
await bp.waitForSelector('[data-testid="gate-continue"]');
check(await bp.locator('[data-testid="toggle-camera"]').count() === 0, '"Before you play" leaves the camera out');
await b.close();

// A real (fake-device) camera already allowed: shown as on, switch locked
const real = await chromium.launch({ args: ['--use-fake-device-for-media-stream'] });
const rc = await real.newContext({ permissions: ['camera'] });
const rp = await rc.newPage();
await rp.goto(`${BASE}/settings`);
await rp.waitForSelector('[data-testid="toggle-camera"]');
await rp.waitForTimeout(500);
check(await isOn(rp, 'camera') && await rp.locator('[data-testid="toggle-camera"]').getAttribute('aria-disabled') !== 'true', 'with the browser already allowing it: On, and still switchable');
await real.close();

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
