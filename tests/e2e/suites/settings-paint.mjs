// Settings opens with every switch already in its real state: no jump
import { BASE } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
// Every frame, what a person could see of each switch
const recorder = () => {
  window.__frames = [];
  const tick = () => {
    const list = document.querySelector('ion-list.permission-list');
    if (list && getComputedStyle(list).visibility === 'visible') {
      const frame = {};
      for (const t of document.querySelectorAll('ion-toggle[data-testid]')) {
        frame[t.dataset.testid] = `${t.checked ? 'on' : 'off'}${t.disabled ? '/locked' : ''}`;
      }
      if (Object.keys(frame).length) window.__frames.push(frame);
    }
    if (window.__frames.length < 120) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const jumps = (frames) => {
  const out = [];
  for (const id of Object.keys(frames.at(-1) || {})) {
    const seen = [...new Set(frames.map((f) => f[id]).filter(Boolean))];
    if (seen.length > 1) out.push(`${id}: ${seen.join(' → ')}`);
  }
  return out;
};

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ permissions: ['geolocation', 'camera'], geolocation: { latitude: 39.19, longitude: -96.58 } });
await ctx.addInitScript(recorder);
const page = await ctx.newPage();
for (const label of ['first visit', 'a later visit']) {
  // The first visit has nothing remembered; the later one reloads with it
  if (label === 'first visit') await page.goto(`${BASE}/settings`); else await page.reload();
  await page.waitForSelector('[data-testid="toggle-location"]');
  await page.waitForTimeout(1500);
  const frames = await page.evaluate(() => window.__frames);
  const final = frames.at(-1);
  check(final?.['toggle-location'] === 'on/locked' && final?.['toggle-camera'] === 'on', `${label}: location on (locked), camera on (switchable)`, JSON.stringify(final));
  const j = jumps(frames);
  check(j.length === 0, `${label}: no switch changes after it appears (${frames.length} frames)`, j.join('; '));
}
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
