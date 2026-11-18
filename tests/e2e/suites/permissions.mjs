// Permissions: asked on entering a lobby, which needs location (and on
// iPhones the compass) to go on. The installed app also offers them all on
// one page when it first opens, where they can be put off, and shows them
// again in Settings, beside the accessibility settings
import { BASE, SHOT, makePlayer, passGate, createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
const isOn = (page, id) => page.locator(`[data-testid="toggle-${id}"]`).evaluate((t) => t.checked);
const visible = (page, sel, timeout = 4000) => page.waitForSelector(sel, { state: 'visible', timeout }).then(() => true, () => false);
// A tap on a switch that's locked (a real tap: it lands on the row behind it), and the popup it brings up
const tapLocked = (page, id) => page.locator(`[data-testid="toggle-${id}"]`).click({ force: true }).catch(() => {});
// (the app keeps other alerts on the page, hidden until they're needed)
const ALERT = 'ion-alert[data-testid="permission-turn-off"]';
const alertSays = async (page) => (await visible(page, `${ALERT} .alert-button`, 3000)
  ? { title: await text(page, `${ALERT} .alert-title`), message: await text(page, `${ALERT} .alert-message`), buttons: await page.locator(`${ALERT} .alert-button`).allInnerTexts() }
  : { title: '', message: '', buttons: [] });
const answerAlert = async (page, button) => {
  await page.locator(`${ALERT} .alert-button`, { hasText: button }).click();
  await page.waitForSelector(`${ALERT} .alert-wrapper`, { state: 'hidden', timeout: 5000 }).catch(() => {});
};
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
check(await maya.locator('[data-testid="toggle-location"]').count() === 1 && await maya.locator('[data-testid="toggle-notify"]').count() === 1,
  'with location and notifications');
check(await maya.locator('[data-testid="toggle-wake"]').count() === 0, 'and no "Keep screen on": that is a setting, not a permission');
check((await asks(maya)).location === 0, 'nothing asked until a switch is tapped');
check(await maya.locator('[data-testid="gate-continue"]').evaluate((b) => b.classList.contains('button-disabled')), 'Continue waits for location');
check(await maya.locator('[data-testid="gate-leave"]').count() === 1, 'and there is a way out: Leave lobby');
await maya.waitForTimeout(500);
await maya.screenshot({ path: `${SHOT}/perm-gate.png` });
await maya.locator('[data-testid="toggle-location"]').click();
await maya.waitForSelector('[data-testid="gate-continue"]:not(.button-disabled)', { timeout: 5000 });
check((await asks(maya)).location >= 1, 'the location switch asks');
await maya.locator('[data-testid="toggle-notify"]').click();
await maya.waitForTimeout(800);
check(await maya.evaluate(() => window.__notifyAsked) === 1 && await isOn(maya, 'notify'), 'the notifications switch asks');
check(await maya.evaluate(async () => !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription())), 'and subscribes this phone straight away');
// Allowed is allowed: the switch can't take it back (only the phone's settings can), and a tap on it says so
await tapLocked(maya, 'notify');
{
  const said = await alertSays(maya);
  check(/Turn notifications off in your phone’s settings/.test(said.title) && /browser’s settings/.test(said.message), 'tapping a switch that\'s on: a popup says only the settings can turn it off', JSON.stringify(said));
  check(said.buttons.length === 1 && /OK/i.test(said.buttons[0]), 'in a browser, which can\'t open them, it only says so', JSON.stringify(said.buttons));
  await maya.screenshot({ path: `${SHOT}/perm-turn-off-browser.png` });
  await answerAlert(maya, 'OK');
}
check(await isOn(maya, 'notify') && await maya.locator('[data-testid="toggle-notify"]').getAttribute('aria-disabled') === 'true'
  && await maya.evaluate(() => localStorage.getItem('manhunt.notificationsOff')) === null && await maya.evaluate(() => window.__notifyAsked) === 1,
  'once allowed, the notifications switch locks: it can\'t be turned off here');
await tapLocked(maya, 'location');
{
  const said = await alertSays(maya);
  check(/Turn location off in your phone’s settings/.test(said.title) && /can’t be joined without it/.test(said.message), 'the same for location, which says a game needs it', JSON.stringify(said));
  await answerAlert(maya, 'OK');
}
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
    && await page.locator('[data-testid="toggle-compass"]').count() === 1 && await page.locator('[data-testid="toggle-wake"]').count() === 0,
    'with location, notifications and compass (and no keep screen on)');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOT}/perm-setup.png` });
  const doneOff = () => page.locator('[data-testid="setup-done"]').evaluate((b) => b.classList.contains('button-disabled'));
  const doneSays = () => text(page, '[data-testid="setup-done"]');
  check(!(await doneOff()) && /Not now/.test(await doneSays()), 'it can be put off: the button says "Not now" and is never disabled', await doneSays());
  await page.locator('[data-testid="toggle-location"]').click();
  await page.locator('[data-testid="toggle-notify"]').click();
  await page.waitForTimeout(800);
  check(/Not now/.test(await doneSays()), 'location alone: still "Not now" (the compass is needed for a game too)', await doneSays());
  check(!(await isOn(page, 'compass')) && /Required/.test(await text(page, '[data-testid="toggle-compass"] >> xpath=ancestor::ion-item')), 'the compass is marked Required');
  await page.locator('[data-testid="toggle-compass"]').click();
  await page.waitForTimeout(600);
  check(/Done/.test(await doneSays()), 'with both, it says Done', await doneSays());
  const statuses = await Promise.all(['location', 'notify', 'compass'].map((k) => isOn(page, k).then((on) => (on ? 'On' : 'Off'))));
  check(statuses.every((s) => s === 'On'), 'each switch asks and turns on', JSON.stringify(statuses));
  // The compass has no setting to send anyone to
  await tapLocked(page, 'compass');
  {
    const said = await alertSays(page);
    check(/compass stays on/.test(said.title) && said.buttons.length === 1, 'tapping the compass once it\'s on: it stays on, and there are no settings to open', JSON.stringify(said));
    await answerAlert(page, 'OK');
  }
  await page.screenshot({ path: `${SHOT}/perm-setup-on.png` });
  await page.locator('[data-testid="setup-done"]').click();
  await page.waitForTimeout(600);
  await page.reload();
  check(!(await visible(page, '[data-testid="setup-done"]', 2500)), 'not shown again');

  // Settings: the permissions again, and how the app looks and behaves
  await page.locator('[data-testid="open-settings"]').click();
  check(await visible(page, '[data-testid="settings-page"]'), 'Settings opens from the home page');
  await page.waitForTimeout(500);
  check(await page.locator('ion-list.permission-list').count() === 1 && await page.locator('[data-testid="toggle-location"]').count() === 1
    && await page.locator('[data-testid="toggle-notify"]').count() === 1 && await page.locator('[data-testid="toggle-camera"]').count() === 1,
    'Settings has the permission switches: location, notifications, the camera');
  check(await isOn(page, 'location') && await isOn(page, 'notify') && await isOn(page, 'compass'), 'showing what was allowed');
  await tapLocked(page, 'location');
  {
    const said = await alertSays(page);
    check(/Turn location off in your phone’s settings/.test(said.title), 'tapping one that\'s on: the popup says only the phone\'s settings can turn it off', JSON.stringify(said));
    await page.screenshot({ path: `${SHOT}/perm-settings-turn-off.png` });
    await answerAlert(page, 'OK');
  }
  await page.screenshot({ path: `${SHOT}/perm-settings.png` });
  const scale = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim());
  const rootPx = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  const basePx = await rootPx();
  check(await scale() === '1', 'text size starts at the default');
  await page.locator('[data-testid="text-size"]').click();
  await page.locator('ion-action-sheet button:has-text("Larger")').click();
  await page.waitForTimeout(600);
  check(await scale() === '1.25' && Math.abs(await rootPx() - basePx * 1.25) < 0.5, 'Text size: Larger makes everything a quarter bigger', `${await scale()} ${await rootPx()} from ${basePx}`);
  await page.screenshot({ path: `${SHOT}/settings-larger.png` });
  await page.reload();
  await page.waitForSelector('[data-testid="settings-page"]');
  check(await scale() === '1.25' && await page.evaluate(() => localStorage.getItem('manhunt.textSize')) === 'larger', 'and is remembered');
  await page.locator('[data-testid="text-size"]').click();
  await page.locator('ion-action-sheet button:has-text("Default")').click();
  await page.waitForTimeout(600);
  check(await scale() === '1', 'and goes back to the default');

  const reduced = () => page.evaluate(() => document.documentElement.classList.contains('reduce-motion'));
  check(!(await reduced()) && !(await isOn(page, 'reduce-motion')), 'Reduce motion starts off (as this browser\'s own setting is)');
  await page.locator('[data-testid="toggle-reduce-motion"]').click();
  await page.waitForTimeout(300);
  check(await reduced() && await isOn(page, 'reduce-motion'), 'Reduce motion turns on');
  await page.reload();
  await page.waitForSelector('[data-testid="settings-page"]');
  await page.waitForTimeout(300);
  check(await reduced() && await isOn(page, 'reduce-motion'), 'and is remembered');
  await page.locator('[data-testid="toggle-reduce-motion"]').click();
  await page.waitForTimeout(300);
  check(!(await reduced()), 'and turns off again');

  await page.locator('[data-testid="toggle-wake"]').click();
  await page.waitForTimeout(300);
  check(!(await isOn(page, 'wake')) && await page.evaluate(() => localStorage.getItem('manhunt.keepScreenOn')) === 'off', 'Keep screen on is here, and can be turned off');
  await page.locator('[data-testid="toggle-wake"]').click();
  await page.waitForTimeout(600);
  check(await isOn(page, 'wake') && await page.evaluate(() => localStorage.getItem('manhunt.keepScreenOn')) === 'on', 'and back on');
  await page.screenshot({ path: `${SHOT}/perm-settings.png` });
  await page.locator('[data-testid="settings-back"]').click();
  check(await visible(page, '[data-testid="home-page"]'), 'and goes back home');

  // A later opening that finds location no longer allowed: the app still opens
  await page.evaluate(() => localStorage.removeItem('__loc'));
  await page.reload();
  check(await visible(page, '[data-testid="home-page"]') && !(await visible(page, '[data-testid="setup-done"]', 2000)),
    'installed app: it opens all the same when location is no longer allowed');
  // ...and it is the lobby that asks, and waits
  const idGate = await createLobby('Gate');
  await page.goto(`${BASE}/lobby/${idGate}`);
  check(await visible(page, '[data-testid="gate-continue"]', 8000), 'entering a lobby is where it is asked for: "Before you play"');
  check(await page.locator('[data-testid="gate-continue"]').evaluate((b) => b.classList.contains('button-disabled')) && !(await isOn(page, 'location')),
    'and Continue waits for it');
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 10);
  await page.waitForTimeout(400);
  check(await visible(page, '[data-testid="gate-continue"]', 1500), 'it can\'t be dismissed into the lobby');
  await page.locator('[data-testid="gate-leave"]').click();
  check(await visible(page, '[data-testid="home-page"]', 6000) && !(await visible(page, '[data-testid="gate-continue"]', 1000)),
    'but "Leave lobby" goes back home: no one is held there');
  // (Leaving emptied that lobby, which ends it: a new one)
  await page.goto(`${BASE}/lobby/${await createLobby('Gate again')}`);
  await page.waitForSelector('[data-testid="gate-continue"]', { timeout: 8000 });
  await page.locator('[data-testid="toggle-location"]').click();
  await page.waitForSelector('[data-testid="gate-continue"]:not(.button-disabled)', { timeout: 5000 });
  await page.locator('[data-testid="gate-continue"]').click();
  check(await page.waitForSelector('[data-testid="gate-continue"]', { state: 'hidden', timeout: 5000 }).then(() => true, () => false)
    && await visible(page, '[data-testid="lobby-page"]'), 'allowing it lets the player into the lobby');

  // With everything a game needs allowed, the installed app isn't asked again
  const id4 = await createLobby('Installed');
  const h = await join(browser, id4, SEEKER, { name: 'Hank', host: true, seeker: true });
  await page.goto(`${BASE}/lobby/${id4}`);
  await page.waitForSelector('[data-testid="lobby-page"]');
  check(!(await visible(page, '[data-testid="gate-continue"]', 2500)), 'installed app: no "Before you play" once what a game needs is allowed');
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

// ===== iPhone Safari: "Before you play" says notifications need the Home Screen app =====
{
  const c = await makePlayer(browser, HIDER, { userAgent: IPHONE });
  await c.addInitScript(() => { delete window.PushManager; localStorage.setItem('manhunt.installOffered', '1'); });
  const page = await c.newPage();
  await page.goto(`${BASE}/lobby/${await createLobby('Safari')}`);
  await page.waitForSelector('[data-testid="gate-continue"]', { timeout: 8000 });
  check(await text(page, '[data-testid="notify-status"]') === 'Only in the Home Screen app', 'iPhone browser: notifications only in the app', await text(page, '[data-testid="notify-status"]'));
  await c.close();
}

// ===== A blocked permission: the page says where it can be allowed =====
{
  const blockedLocation = () => {
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d.name === 'geolocation' ? Promise.resolve({ state: 'denied', onchange: null }) : q(d));
  };
  // In a browser there's nothing to open: it says where to look
  const c = await makePlayer(browser, HIDER);
  await c.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await c.addInitScript(blockedLocation);
  const page = await c.newPage();
  await page.goto(BASE);
  check(await visible(page, '[data-testid="permission-blocked"]'), 'blocked location: the permissions page says so');
  check(/Blocked/.test(await text(page, '[data-testid="location-status"]')) && /settings for Manhunt/.test(await text(page, '[data-testid="permission-blocked"]')),
    'and that only the phone\'s or browser\'s settings can allow it', await text(page, '[data-testid="permission-blocked"]'));
  check(await page.locator('[data-testid="open-phone-settings"]').count() === 0, 'a browser has no "Open settings" button');
  check(!(await page.locator('[data-testid="setup-done"]').evaluate((b) => b.classList.contains('button-disabled'))), 'and the page can still be put off: the app opens without it');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT}/perm-blocked-setup.png` });
  await c.close();

  // In the native apps the button asks the app, which opens the phone's settings
  const n = await makePlayer(browser, HIDER);
  await n.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await n.addInitScript(blockedLocation);
  const nativeApp = () => { window.__opened = []; window.__manhuntNative = { openSettings(options) { window.__opened.push(options?.direct === true ? 'direct' : 'explained'); } }; };
  const opened = (page) => page.evaluate(() => window.__opened.join(','));
  await n.addInitScript(nativeApp);
  const native = await n.newPage();
  await native.goto(BASE);
  check(await visible(native, '[data-testid="open-phone-settings"]'), 'native app: an "Open settings" button beside a blocked permission');
  await native.locator('[data-testid="open-phone-settings"]').click();
  check(await opened(native) === 'explained', 'which asks the app to say what Manhunt needs and open the phone\'s settings', await opened(native));
  await native.screenshot({ path: `${SHOT}/perm-blocked-native.png` });
  await tapLocked(native, 'location');
  await native.waitForTimeout(400);
  check(await opened(native) === 'explained,explained' && !(await native.locator(`${ALERT} .alert-wrapper`).isVisible()), 'tapping the blocked switch itself does the same', await opened(native));
  await n.close();

  // ===== Turning one off: only in the phone's settings, and the native apps offer to go =====
  const o = await makePlayer(browser, HIDER);
  await o.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await o.addInitScript(askLog);
  await o.addInitScript(fakePush);
  await o.addInitScript(nativeApp);
  const on = await o.newPage();
  await on.goto(BASE);
  await on.waitForSelector('[data-testid="setup-done"]', { timeout: 8000 });
  await on.locator('[data-testid="toggle-notify"]').click();
  await on.waitForFunction(() => document.querySelector('[data-testid="toggle-notify"]').checked, null, { timeout: 5000 }).catch(() => {});
  await tapLocked(on, 'notify');
  let said = await alertSays(on);
  check(/Turn notifications off in your phone’s settings/.test(said.title) && /only your phone’s settings can/.test(said.message),
    'native app: tapping a switch that\'s on says only the phone\'s settings can turn it off', JSON.stringify(said));
  check(said.buttons.length === 2 && /Not now/i.test(said.buttons[0]) && /Open settings/i.test(said.buttons[1]), 'and offers to open them', JSON.stringify(said.buttons));
  await on.waitForTimeout(400);
  await on.screenshot({ path: `${SHOT}/perm-turn-off-native.png` });
  await answerAlert(on, 'Not now');
  check(await opened(on) === '' && await isOn(on, 'notify'), '"Not now" leaves everything as it was', await opened(on));
  await tapLocked(on, 'notify');
  said = await alertSays(on);
  await answerAlert(on, 'Open settings');
  check(await opened(on) === 'direct', '"Open settings" goes straight there: the popup has already said why', await opened(on));
  check(await isOn(on, 'notify') && await on.evaluate(() => window.__notifyAsked) === 1, 'and the switch is still on: nothing was asked again');
  await o.close();
}

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
