// A hider indoors: scattered fixes in, a steady position out to the seekers
import { createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';
const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };

const SEEKER = { latitude: 39.19, longitude: -96.58 };
const SPOT = { latitude: 39.1915, longitude: -96.5790 };
const M = 111320, ML = M * Math.cos(SPOT.latitude * Math.PI / 180);
let seed = 5; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const n = () => Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r());
const dist = (a, b) => Math.hypot((a.latitude - b.latitude) * M, (a.longitude - b.longitude) * ML);

const id = await createLobby('Steady');
const host = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
const maya = await join(browser, id, SPOT, { name: 'Maya' });
await startGame(host.page, maya.page);
await host.page.evaluate(() => { window.__seen = []; window.__manhuntSocket.on('lobby-state', (s) => {
  const m = s.players.find((p) => p.name === 'Maya'); if (m?.latitude != null) window.__seen.push({ latitude: m.latitude, longitude: m.longitude }); }); });

const sent = [];
for (let i = 0; i < 60; i++) {
  const f = { latitude: SPOT.latitude + n() * 40 / M, longitude: SPOT.longitude + n() * 40 / ML, accuracy: 40 };
  sent.push(f);
  await maya.ctx.setGeolocation(f);
  await maya.page.waitForTimeout(1100);
}
const seen = await host.page.evaluate(() => window.__seen);
const late = seen.slice(Math.floor(seen.length / 2));
const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const rawOff = avg(sent.slice(30).map((f) => dist(f, SPOT)));
const seenOff = avg(late.map((p) => dist(p, SPOT)));
const seenJump = avg(late.slice(1).map((p, i) => dist(p, late[i])));
console.log(`raw fixes ${rawOff.toFixed(0)} m off; seekers see ${seenOff.toFixed(0)} m off, moving ${seenJump.toFixed(1)} m per update (${seen.length} updates)`);
check(seen.length > 20, 'seekers kept getting updates');
check(seenOff < rawOff / 2.5, 'what seekers see is far steadier than the raw fixes');

// The hider walks out: good fixes 80 m away are followed quickly
const outside = { latitude: SPOT.latitude + 80 / M, longitude: SPOT.longitude, accuracy: 5 };
for (let i = 0; i < 6; i++) { await maya.ctx.setGeolocation({ ...outside, latitude: outside.latitude + i * 1e-6 }); await maya.page.waitForTimeout(1100); }
const last = (await host.page.evaluate(() => window.__seen)).at(-1);
check(dist(last, outside) < 12, 'out in the open, seekers see where the hider really is', `${dist(last, outside).toFixed(1)} m`);
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
