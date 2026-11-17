// Push notifications end to end: turning them on in "Before you play", the
// server pushing to players who aren't looking when someone is found, and the
// service worker showing the notice and taking a tap to the lobby.
import { readFileSync, existsSync } from 'node:fs';
import { BASE, SHOT, makePlayer, passGate, rename, createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

// The runner's server records each push here instead of sending it (run.mjs)
const PUSH_LOG = process.env.E2E_PUSH_LOG;
if (!PUSH_LOG) { console.error('Run this through tests/e2e/run.mjs, which records the pushes'); process.exit(1); }
const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const isOn = (page, id) => page.locator(`[data-testid="toggle-${id}"]`).evaluate((t) => t.checked);
const pushes = () => (existsSync(PUSH_LOG) ? readFileSync(PUSH_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// Sandbox Chromium has no push service: stand in for permission + subscribe
const fakePush = () => () => {
  let permission = 'default';
  Object.defineProperty(Notification, 'permission', { configurable: true, get: () => permission });
  Notification.requestPermission = async () => { window.__asked = (window.__asked || 0) + 1; permission = 'granted'; return permission; };
  let sub = null;
  const make = (key) => ({
    endpoint: `https://web.push.apple.com/test-${window.__pushName}`,
    options: { applicationServerKey: key.buffer },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }; },
    unsubscribe: async () => { sub = null; return true; }
  });
  PushManager.prototype.getSubscription = async () => sub;
  PushManager.prototype.subscribe = async ({ applicationServerKey }) => { window.__subscribed = true; return (sub = make(applicationServerKey)); };
};

const SEEKER = { latitude: 39.19, longitude: -96.58 };
const NEAR = { latitude: 39.1903, longitude: -96.58 };
const FAR = { latitude: 39.192, longitude: -96.58 };

const id = await createLobby('Riverside Park');
const host = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });

// --- Maya turns notifications on in "Before you play" ---
const mayaCtx = await makePlayer(browser, NEAR);
await mayaCtx.addInitScript(fakePush());
await mayaCtx.addInitScript(() => { window.__pushName = 'maya'; });
const maya = await mayaCtx.newPage();
await maya.goto(`${BASE}/lobby/${id}`);
await maya.waitForSelector('[data-testid="toggle-notify"]', { timeout: 10000 });
check(!(await isOn(maya, 'notify')), 'notifications start Off');
await maya.locator('[data-testid="toggle-notify"]').click();
await maya.waitForTimeout(800);
check(await maya.evaluate(() => window.__asked) === 1 && await maya.evaluate(() => window.__subscribed), 'one tap asks permission and subscribes');
await passGate(maya);
await rename(maya, 'Maya');

// --- Priya: on already (from an earlier game) ---
const priyaCtx = await makePlayer(browser, FAR);
await priyaCtx.addInitScript(fakePush());
await priyaCtx.addInitScript(() => { window.__pushName = 'priya'; });
const priya = await priyaCtx.newPage();
await priyaCtx.addInitScript(() => { Notification.requestPermission(); }); // allowed in an earlier game
await priya.goto(`${BASE}/lobby/${id}`);
await passGate(priya);
await rename(priya, 'Priya');
check(await priya.evaluate(() => window.__subscribed === true), 'an already-allowed phone subscribes by itself on join');

// --- Priya puts her phone away; Maya is found ---
await startGame(host.page, maya, priya);

await priya.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await priya.waitForTimeout(500);
const before = pushes().length;
await maya.waitForFunction(() => { const b = document.querySelector('[data-testid="found-btn"]'); return b && !b.hasAttribute('disabled') && !b.classList.contains('button-disabled'); }, null, { timeout: 8000 });
await maya.locator('[data-testid="found-btn"]').click();
await maya.waitForSelector('ion-alert.found-alert');
await maya.locator('ion-alert.found-alert button:has-text("I’ve been found")').click();
await host.page.waitForTimeout(2500);
const sent = pushes().slice(before);
check(sent.length === 1 && sent[0].endpoint.endsWith('/test-priya') && sent[0].payload.title === 'Maya was found',
  'exactly one push sent: to Priya, who is away (not Hank, who is looking, nor Maya)', JSON.stringify(sent));

// --- The service worker shows a push and a tap opens the lobby ---
// (headless-shell Chromium refuses notifications; the full build shows them)
const full = await chromium.launch({ channel: 'chromium' });
const swCtx = await full.newContext();
await swCtx.grantPermissions(['notifications'], { origin: new URL(BASE).origin });
const page = await swCtx.newPage();
await page.goto(BASE);
await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 });
const cdp = await swCtx.newCDPSession(page);
const registrationId = await new Promise((resolve) => {
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
    const r = registrations.find((x) => !x.isDeleted); if (r) resolve(r.registrationId);
  });
  cdp.send('ServiceWorker.enable');
});
await cdp.send('ServiceWorker.deliverPushMessage', {
  origin: new URL(BASE).origin, registrationId,
  data: JSON.stringify({ title: 'Maya was found', body: '1 hider left · Riverside Park', url: `/lobby/${id}`, tag: `manhunt-${id}` })
});
await page.waitForTimeout(800);
const shown = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())
  .map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data?.url })));
check(shown.length === 1 && shown[0].title === 'Maya was found' && shown[0].body === '1 hider left · Riverside Park'
  && shown[0].tag === `manhunt-${id}` && shown[0].url === `/lobby/${id}`, 'service worker shows the notice', JSON.stringify(shown));

// Tap it: dispatched inside the worker the way the browser would
const [worker] = swCtx.serviceWorkers();
await worker.evaluate(async () => {
  const [n] = await self.registration.getNotifications();
  // eslint-disable-next-line no-undef -- a service worker global
  const event = new NotificationEvent('notificationclick', { notification: n });
  // An untrusted event's waitUntil throws; the handler itself is what's tested
  Object.defineProperty(event, 'waitUntil', { value: (p) => p });
  self.dispatchEvent(event);
});
await page.waitForURL(`**/lobby/${id}`, { timeout: 5000 }).catch(() => {});
check(new URL(page.url()).pathname === `/lobby/${id}`, 'tapping it brings the open app to that lobby', page.url());

await full.close();
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
