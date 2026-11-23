// The hider's map of their own side (as the seekers see it, no better), and every seeker in one colour on the seeker's map
import { SHOT, createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
const waitFor = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
// What reaches a phone, not just what it shows
const tap = (page) => page.evaluate(() => { window.__states = []; window.__manhuntSocket.on('lobby-state', (s) => window.__states.push(s)); });
const lastPlayers = (page) => page.evaluate(() => window.__states.filter((s) => s.phase === 'playing').at(-1)?.players ?? []);
const everSawASeeker = (page) => page.evaluate(() => window.__states.filter((s) => s.phase === 'playing')
  .some((s) => s.players.some((p) => p.is_seeker && p.latitude !== null)));

const HANK = { latitude: 39.19, longitude: -96.58 };       // seeker
const SAM = { latitude: 39.1895, longitude: -96.5812 };    // seeker
const MAYA = { latitude: 39.1915, longitude: -96.5795 };   // hider
const PRIYA = { latitude: 39.1921, longitude: -96.5808 };  // hider

const id = await createLobby('Sides');
const hank = await join(browser, id, HANK, { name: 'Hank', host: true, seeker: true });
const sam = await join(browser, id, SAM, { name: 'Sam', seeker: true });
const maya = await join(browser, id, MAYA, { name: 'Maya' });
const priya = await join(browser, id, PRIYA, { name: 'Priya' });
await tap(maya.page);
await tap(hank.page);
await startGame(hank.page, sam.page, maya.page, priya.page);

// --- A hider: the seekers card first, the map a tap away ---
await maya.page.waitForSelector('[data-testid="hider-screen"]');
check(await maya.page.locator('[data-testid="hider-screen"]').getAttribute('data-mode') === 'info'
  && await maya.page.locator('[data-testid="seeker-info"]').count() === 1, 'a hider starts on the seekers card');
await maya.page.screenshot({ path: `${SHOT}/hider-map-info.png` });
await maya.page.locator('[data-testid="hider-map-btn"]').click();
await maya.page.waitForSelector('[data-testid="track-map"]');
check(await waitFor(maya.page, () => document.querySelectorAll('[data-testid="track-pin"]').length === 1), 'the map shows her fellow hider', `${await maya.page.locator('[data-testid="track-pin"]').count()} pins`);
check(/Priya/.test(await text(maya.page, '[data-testid="track-pin"]')), 'by name', await text(maya.page, '[data-testid="track-pin"]'));
check(await maya.page.locator('.track-pin-label', { hasText: /^You$/ }).count() === 1, 'and herself, as "You"');
check(await maya.page.locator('.track-seeker, .track-you').count() === 0, 'no seeker is drawn on a hider\'s map');
check(/You and 1 other hider · seekers aren’t shown/.test(await text(maya.page, '[data-testid="hider-map-note"]')), 'and a line says so', await text(maya.page, '[data-testid="hider-map-note"]'));
await maya.page.waitForTimeout(1200);
await maya.page.screenshot({ path: `${SHOT}/hider-map.png` });

// On the wire: for Priya, the very point the seekers have (she is standing
// still, so an area), not her position. A hider who gets caught has learned
// nothing the seekers didn't know. And never a seeker's position
const where = (list) => { const p = list.find((q) => q.name === 'Priya'); return p && [p.latitude, p.longitude, p.uncertainty_m]; };
const mayaHas = where(await lastPlayers(maya.page));
const hankHas = where(await lastPlayers(hank.page));
check(JSON.stringify(mayaHas) === JSON.stringify(hankHas), 'her phone has for Priya exactly what a seeker\'s has', `${JSON.stringify(mayaHas)} vs ${JSON.stringify(hankHas)}`);
check(mayaHas[2] === 25 && mayaHas[0] !== PRIYA.latitude, 'which is an area, not where Priya is', JSON.stringify(mayaHas));
check(await maya.page.locator('[data-testid="track-area"]').count() === 1, 'and her map draws that area');
check(!(await everSawASeeker(maya.page)), 'she has never been sent a seeker\'s position');

// Priya moves a few hundred metres: her area on Maya's map moves with her
const pinAt = () => maya.page.locator('[data-testid="track-pin"]').evaluate((pin) => pin.style.transform);
const before = await pinAt();
await priya.ctx.setGeolocation({ latitude: PRIYA.latitude + 0.003, longitude: PRIYA.longitude });
check(await waitFor(maya.page, (was) => document.querySelector('[data-testid="track-pin"]')?.style.transform !== was, before, 10000), 'when Priya moves on, her pin moves');

// Centre on me: Maya in the middle of her own map
await maya.page.locator('[data-testid="track-map-me"]').click();
await maya.page.waitForTimeout(900);
const offCentre = await maya.page.evaluate(() => {
  const map = document.querySelector('.track-map-wrap').getBoundingClientRect();
  const you = [...document.querySelectorAll('.track-pin')].find((pin) => /You/.test(pin.innerText)).querySelector('.track-pin-disc').getBoundingClientRect();
  return Math.hypot((you.left + you.right) / 2 - (map.left + map.right) / 2, (you.top + you.bottom) / 2 - (map.top + map.bottom) / 2);
});
check(offCentre < 4 && await maya.page.locator('[data-testid="track-map-me"]').getAttribute('aria-pressed') === 'true', 'Centre on me puts her in the middle of her map', String(offCentre));
await maya.page.screenshot({ path: `${SHOT}/hider-map-centred.png` });

// The choice of map is remembered, and the seekers card is still a tap away
await maya.page.reload();
await maya.page.waitForSelector('[data-testid="hider-screen"]');
check(await maya.page.locator('[data-testid="hider-screen"]').getAttribute('data-mode') === 'map', 'the map is remembered after a reload');
await maya.page.locator('[data-testid="hider-info-btn"]').click();
check(await waitFor(maya.page, () => !!document.querySelector('[data-testid="seeker-info"]')), 'and Seekers goes back to the card');

// --- A seeker: the other seekers on the map, the same colour as you ---
await hank.page.locator('[data-testid="target-card"]').first().click();
await hank.page.waitForSelector('[data-testid="target-readout"]');
await hank.page.locator('[data-testid="track-map-btn"]').click();
await hank.page.waitForSelector('[data-testid="track-map"]');
check(await waitFor(hank.page, () => document.querySelectorAll('.track-seeker').length === 1 && document.querySelectorAll('.track-you').length === 1), 'a seeker\'s map shows the other seeker, and you');
const fills = await hank.page.evaluate(() => [...document.querySelectorAll('.track-seeker, .track-you')].map((dot) => dot.getAttribute('fill')));
check(fills.length === 2 && new Set(fills).size === 1, 'in one colour', fills.join(', '));
check(await hank.page.locator('[data-testid="track-pin"]').count() === 2, 'and both hiders as pins');
await hank.page.waitForTimeout(1200);
await hank.page.screenshot({ path: `${SHOT}/seeker-map-seekers.png` });

await Promise.all([hank, sam, maya, priya].map((p) => p.ctx.close()));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
