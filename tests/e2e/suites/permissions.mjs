// Permissions: asked right before they're needed in the browser; asked in
// one popup when the installed app first opens, then kept on Settings
import { BASE, SHOT, makePlayer, passGate, createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
const isOn = (page, id) => page.locator(`[data-testid="toggle-${id}"]`).evaluate((t) => t.checked);
const visible = (page, sel, timeout = 4000) => page.waitForSelector(sel, { state: 'visible', timeout }).then(() => true, () => false);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const SEEKER = { latitude: 39.19, longitude: -96.58 };
const HIDER = { latitude: 39.1915, longitude: -96.58 };

// Count what the page asks for, as if nothing had been allowed yet
const askLog = () => {
  window.__asks = { location: 0, wake: 0 };
  const realQuery = navigator.permissions.query.bind(navigator.permissions);
  let locationAllowed = localStorage.getItem('__loc') === '1';
  navigator.permissions.query = (d) => d.name === 'geolocation'
    ? Promise.resolve({ state: locationAllowed ? 'granted' : 'prompt', onchange: null }) : realQuery(d);
  for (const fn of ['watchPosition', 'getCurrentPosition']) {
    const real = navigator.geolocation[fn].bind(navigator.geolocation);
    navigator.geolocation[fn] = (...args) => { window.__asks.location++; locationAllowed = true; localStorage.setItem('__loc', '1'); return real(...args); };
  }
  navigator.wakeLock.request = async () => { window.__asks.wake++; return { addEventListener() {}, release: async () => {} }; };
};
// Notifications without a real push service (sandbox Chromium has none)
const fakePush = () => {
  let permission = localStorage.getItem('__notify') || 'default';
  Object.defineProperty(Notification, 'permission', { configurable: true, get: () => permission });
  Notification.requestPermission = async () => { window.__notifyAsked = (window.__notifyAsked || 0) + 1; permission = 'granted'; localStorage.setItem('__notify', 'granted'); return permission; };
  let sub = null;
  PushManager.prototype.getSubscription = async () => sub;
  PushManager.prototype.subscribe = async ({ applicationServerKey }) => (sub = {
    endpoint: 'https://web.push.apple.com/test-perm', options: { applicationServerKey: applicationServerKey.buffer },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }; },
    unsubscribe: async () => true });
};
const asks = (page) => page.evaluate(() => window.__asks);

// ===== In the browser =====
const id = await createLobby('Browser');
const host = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
const ctx = await makePlayer(browser, HIDER);
await ctx.addInitScript(askLog);
await ctx.addInitScript(fakePush);
await ctx.addInitScript(() => { window.__pushName = 'maya'; });
const maya = await ctx.newPage();
await maya.goto(`${BASE}/lobby/${id}`);
check(await visible(maya, '[data-testid="gate-continue"]', 8000), 'browser: "Before you play" on entering the lobby');
check(await maya.locator('[data-testid="toggle-location"]').count() === 1 && await maya.locator('[data-testid="toggle-notify"]').count() === 1
  && await maya.locator('[data-testid="toggle-wake"]').count() === 1, 'with location, notifications and keep screen on');
check((await asks(maya)).location === 0, 'nothing asked until a switch is tapped');
check(await maya.locator('[data-testid="gate-continue"]').evaluate((b) => b.classList.contains('button-disabled')), 'Continue waits for location');
await maya.waitForTimeout(500);
await maya.screenshot({ path: `${SHOT}/perm-gate.png` });
await maya.locator('[data-testid="toggle-location"]').click();
await maya.waitForSelector('[data-testid="gate-continue"]:not(.button-disabled)', { timeout: 5000 });
check((await asks(maya)).location >= 1, 'the location switch asks');
await maya.locator('[data-testid="toggle-notify"]').click();
await maya.waitForTimeout(800);
check(await maya.evaluate(() => window.__notifyAsked) === 1 && await isOn(maya, 'notify'), 'the notifications switch asks');
check(await maya.evaluate(async () => !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription())), 'and subscribes this phone straight away');
await maya.evaluate(() => {
  window.__pushSent = [];
  const emit = window.__manhuntSocket.emit.bind(window.__manhuntSocket);
  window.__manhuntSocket.emit = (event, data, ...rest) => { if (event === 'push-subscribe') window.__pushSent.push(data.subscription); return emit(event, data, ...rest); };
});
await maya.locator('[data-testid="toggle-notify"]').click();
await maya.waitForTimeout(600);
check(!(await isOn(maya, 'notify')) && await maya.evaluate(() => window.__pushSent.at(-1) === null),
  'an optional switch turns off again: notifications stop (the server forgets this phone)', JSON.stringify(await maya.evaluate(() => window.__pushSent)));
check(await maya.evaluate(() => localStorage.getItem('manhunt.notificationsOff')) === '1', 'and the choice is remembered');
await maya.locator('[data-testid="toggle-notify"]').click();
await maya.waitForTimeout(800);
check(await isOn(maya, 'notify') && await maya.evaluate(() => window.__notifyAsked) === 1
  && await maya.evaluate(() => window.__pushSent.at(-1)?.endpoint?.startsWith('https://web.push.apple.com/')), 'and back on, without asking again');
await maya.locator('[data-testid="toggle-wake"]').click();
await maya.waitForTimeout(300);
check(!(await isOn(maya, 'wake')), 'Keep screen on turns off here too');
await maya.locator('[data-testid="toggle-wake"]').click();
await maya.screenshot({ path: `${SHOT}/perm-gate-on.png` });
check(await maya.locator('ion-modal.show-modal .permission-status').count() === 0, 'plain on and off need no words under the switches');
await maya.locator('[data-testid="gate-continue"]').click();
check(await maya.waitForSelector('[data-testid="gate-continue"]', { state: 'hidden', timeout: 5000 }).then(() => true, () => false), 'Continue goes into the lobby');
check((await asks(maya)).wake === 0, 'the screen is left alone before the game');
await startGame(host.page, maya);
await maya.waitForTimeout(1000);
check((await asks(maya)).wake >= 1, 'and kept on during it');
check(!(await visible(maya, 'ion-toast.notify-offer-toast', 1500)), 'nothing more is asked in the game');
await maya.reload();
check(await visible(maya, '[data-testid="gate-continue"]', 8000) && !(await maya.locator('[data-testid="gate-continue"]').evaluate((b) => b.classList.contains('button-disabled'))),
  'coming back: the switches remember, Continue is ready');
await ctx.close();

// Screen kept on only if wanted
{
  const id3 = await createLobby('NoWake');
  const h = await join(browser, id3, SEEKER, { name: 'Hank', host: true, seeker: true });
  const c = await makePlayer(browser, HIDER);
  await c.addInitScript(askLog);
  await c.addInitScript(() => localStorage.setItem('manhunt.keepScreenOn', 'off'));
  const page = await c.newPage();
  await page.goto(`${BASE}/lobby/${id3}`);
  await passGate(page);
  await startGame(h.page, page);
  await page.waitForTimeout(800);
  await page.mouse.click(200, 400);
  check((await asks(page)).wake === 0, 'with Keep screen on turned off, the screen is left alone');
  await c.close();
  await h.ctx.close();
}

// ===== The installed app =====
{
  const c = await makePlayer(browser, HIDER);
  await c.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  await c.addInitScript(askLog);
  await c.addInitScript(fakePush);
  // An iPhone-style motion permission, so the compass row shows
  await c.addInitScript(() => {
    window.DeviceOrientationEvent.requestPermission = async () => { window.__compassAsked = true; return 'granted'; };
  });
  const page = await c.newPage();
  await page.goto(BASE);
  check(await visible(page, '[data-testid="setup-done"]'), 'installed app: a setup popup on first open');
  check(await page.locator('[data-testid="toggle-location"]').count() === 1 && await page.locator('[data-testid="toggle-notify"]').count() === 1
    && await page.locator('[data-testid="toggle-compass"]').count() === 1 && await page.locator('[data-testid="toggle-wake"]').count() === 1,
    'with location, notifications, compass and keep screen on');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOT}/perm-setup.png` });
  const doneOff = () => page.locator('[data-testid="setup-done"]').evaluate((b) => b.classList.contains('button-disabled'));
  check(await doneOff(), 'Done waits for the required ones');
  await page.locator('[data-testid="toggle-location"]').click();
  await page.locator('[data-testid="toggle-notify"]').click();
  await page.waitForTimeout(800);
  check(await doneOff(), 'location alone is not enough: the compass is required too');
  check(!(await isOn(page, 'compass')) && /Required/.test(await text(page, '[data-testid="toggle-compass"] >> xpath=ancestor::ion-item')), 'the compass is marked Required');
  await page.locator('[data-testid="toggle-compass"]').click();
  await page.waitForTimeout(600);
  check(!(await doneOff()), 'with both, Done is ready');
  const statuses = await Promise.all(['location', 'notify', 'compass', 'wake'].map((k) => isOn(page, k).then((on) => (on ? 'On' : 'Off'))));
  check(statuses.every((s) => s === 'On'), 'each switch asks and turns on', JSON.stringify(statuses));
  await page.screenshot({ path: `${SHOT}/perm-setup-on.png` });
  await page.locator('[data-testid="setup-done"]').click();
  await page.waitForTimeout(600);
  await page.reload();
  check(!(await visible(page, '[data-testid="setup-done"]', 2500)), 'not shown again');

  await page.locator('[data-testid="open-settings"]').click();
  check(await visible(page, '[data-testid="settings-page"]'), 'Settings opens from the home page');
  await page.waitForTimeout(500);
  const later = await Promise.all(['location', 'notify', 'compass', 'wake'].map((k) => isOn(page, k).then((on) => (on ? 'On' : 'Off'))));
  check(later.every((s) => s === 'On'), 'and shows the same switches', JSON.stringify(later));
  await page.locator('[data-testid="toggle-notify"]').click();
  await page.waitForTimeout(500);
  check(!(await isOn(page, 'notify')), 'Settings: notifications turn off');
  await page.reload();
  await page.waitForSelector('[data-testid="settings-page"]');
  await page.waitForTimeout(400);
  check(!(await isOn(page, 'notify')), 'and stay off');
  await page.locator('[data-testid="toggle-notify"]').click();
  await page.waitForTimeout(500);
  check(await isOn(page, 'notify'), 'and turn back on');
  await page.locator('[data-testid="toggle-wake"]').click();
  await page.waitForTimeout(300);
  check(!(await isOn(page, 'wake')) && await page.evaluate(() => localStorage.getItem('manhunt.keepScreenOn')) === 'off', 'Keep screen on can be turned off there');
  await page.locator('[data-testid="toggle-wake"]').click();
  await page.waitForTimeout(600);
  check(await page.locator('[data-testid="toggle-wake"]').evaluate((t) => t.checked) && await isOn(page, 'wake'), 'and back on');
  await page.screenshot({ path: `${SHOT}/perm-settings.png` });
  await page.locator('[data-testid="settings-back"]').click();
  check(await visible(page, '[data-testid="home-page"]'), 'and goes back home');

  // In a game the installed app doesn't ask again
  const id4 = await createLobby('Installed');
  const h = await join(browser, id4, SEEKER, { name: 'Hank', host: true, seeker: true });
  await page.goto(`${BASE}/lobby/${id4}`);
  await page.waitForSelector('[data-testid="lobby-page"]');
  check(!(await visible(page, '[data-testid="gate-continue"]', 2500)), 'installed app: no "Before you play" in lobbies');
  await startGame(h.page, page);
  await c.close();
  await h.ctx.close();
}

// ===== iPhone browser: "Before you play" needs the compass too =====
{
  const id5 = await createLobby('Compass');
  const c = await makePlayer(browser, HIDER, { userAgent: IPHONE });
  await c.addInitScript(() => {
    localStorage.setItem('manhunt.installOffered', '1');
    window.DeviceOrientationEvent.requestPermission = () => (window.__compassAnswer === 'wait'
      ? new Promise((resolve) => { window.__answerCompass = resolve; })
      : Promise.resolve(window.__compassAnswer || 'granted'));
  });
  const page = await c.newPage();
  await page.goto(`${BASE}/lobby/${id5}`);
  await page.waitForSelector('[data-testid="toggle-compass"]', { timeout: 8000 });
  const continueOff = () => page.locator('[data-testid="gate-continue"]').evaluate((b) => b.classList.contains('button-disabled'));
  check(await continueOff(), 'iPhone browser: location is allowed but Continue waits for the compass');
  const colour = () => page.locator('[data-testid="compass-status"]').evaluate((n) => getComputedStyle(n).color);
  // While the phone's own question is up: "Asking…", in grey
  await page.evaluate(() => { window.__compassAnswer = 'wait'; });
  await page.locator('[data-testid="toggle-compass"]').click();
  await page.waitForTimeout(300);
  check(await text(page, '[data-testid="compass-status"]') === 'Asking…' && await colour() === 'rgb(137, 144, 162)', 'asking: "Asking…" in grey, nothing more', `${await text(page, '[data-testid="compass-status"]')} ${await colour()}`);
  await page.evaluate(() => window.__answerCompass('denied'));
  await page.waitForTimeout(400);
  check(await text(page, '[data-testid="compass-status"]') === 'Blocked' && await colour() === 'rgb(235, 101, 106)' && await continueOff(),
    'refused: just "Blocked", in red, and it still blocks', `${await text(page, '[data-testid="compass-status"]')} ${await colour()}`);
  await page.screenshot({ path: `${SHOT}/perm-blocked.png` });
  await page.evaluate(() => { window.__compassAnswer = 'denied'; });
  await page.evaluate(() => { window.__compassAnswer = 'granted'; });
  await page.locator('[data-testid="toggle-compass"]').click();
  await page.waitForTimeout(500);
  check(!(await continueOff()), 'allowed: Continue is ready');
  await page.screenshot({ path: `${SHOT}/perm-gate-ios.png` });
  await c.close();
}

// ===== iPhone Safari: Settings says notifications need the Home Screen app =====
{
  const c = await makePlayer(browser, HIDER, { userAgent: IPHONE });
  await c.addInitScript(() => { delete window.PushManager; localStorage.setItem('manhunt.installOffered', '1'); });
  const page = await c.newPage();
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('[data-testid="settings-page"]');
  check(await text(page, '[data-testid="notify-status"]') === 'Only in the Home Screen app', 'iPhone browser: notifications only in the app', await text(page, '[data-testid="notify-status"]'));
  await c.close();
}

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
