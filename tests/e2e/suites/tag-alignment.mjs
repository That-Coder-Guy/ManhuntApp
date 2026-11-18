// Do the Required / Optional tags start on one vertical line?
import { BASE, SHOT, makePlayer, createLobby } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';
const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const tags = (page) => page.$$eval('ion-list.permission-list ion-item', (items) => items.map((i) => {
  const t = i.querySelector('.permission-title').getBoundingClientRect();
  const r = i.querySelector('.permission-requirement').getBoundingClientRect();
  return { title: i.querySelector('.permission-title').innerText, tagX: Math.round(r.left), wrapped: r.top > t.top + 4 };
}));
for (const width of [390, 375, 320]) {
  const ctx = await makePlayer(browser, { latitude: 39.19, longitude: -96.58 }, { viewport: { width, height: 760 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    window.DeviceOrientationEvent.requestPermission = async () => 'granted';
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="setup-done"]');
  await page.waitForTimeout(800);
  const t = await tags(page);
  const inline = t.filter((x) => !x.wrapped);
  const xs = [...new Set(inline.map((x) => x.tagX))];
  console.log(`${width}px popup:`, t.map((x) => `${x.title}@${x.tagX}${x.wrapped ? ' (below)' : ''}`).join(' | '));
  check(xs.length <= 1, `${width}px popup: the tags beside their titles share one line`, xs.join(', '));
  if (width === 390) check(t.every((x) => !x.wrapped), '390px: all tags fit beside their titles');
  await page.screenshot({ path: `${SHOT}/tags-${width}.png` });
  await ctx.close();
}
// "Before you play" (browser)
const ctx = await makePlayer(browser, { latitude: 39.19, longitude: -96.58 });
const page = await ctx.newPage();
await page.goto(`${BASE}/lobby/${await createLobby('Tags')}`);
await page.waitForSelector('[data-testid="gate-continue"]');
await page.waitForTimeout(800);
const t = await tags(page);
check(new Set(t.map((x) => x.tagX)).size === 1 && t.every((x) => !x.wrapped), '"Before you play": one line', t.map((x) => `${x.title}@${x.tagX}`).join(' | '));
await page.screenshot({ path: `${SHOT}/tags-gate.png` });
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
