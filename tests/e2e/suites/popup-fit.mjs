// Does the installed app's first-open popup fit small iPhone screens?
import { BASE, SHOT, makePlayer } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';
const browser = await chromium.launch();
const tag = process.argv[2] || 'now';
let bad = 0;
for (const [w, h] of [[320, 568], [375, 667], [390, 844]]) {
  const ctx = await makePlayer(browser, { latitude: 39.19, longitude: -96.58 }, { viewport: { width: w, height: h } });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    window.DeviceOrientationEvent.requestPermission = async () => 'granted';
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d.name === 'geolocation' ? Promise.resolve({ state: 'prompt' }) : q(d));
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="setup-done"]');
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const modal = document.querySelector('ion-modal.permissions-dialog');
    const box = modal.shadowRoot.querySelector('[part="content"]').getBoundingClientRect();
    const done = document.querySelector('[data-testid="setup-done"]').getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), done: Math.round(done.bottom), vh: innerHeight };
  });
  const fits = r.top >= 0 && r.bottom <= r.vh && r.done <= r.vh;
  if (!fits) bad++;
  console.log(`${w}x${h}: dialog ${r.top}–${r.bottom}, Done ends ${r.done}, screen ${r.vh} → ${fits ? 'fits' : 'OVERFLOWS'}`);
  await page.screenshot({ path: `${SHOT}/setup-fit-${tag}-${w}.png` });
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
