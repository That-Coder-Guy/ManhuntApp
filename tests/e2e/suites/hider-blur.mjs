// How exactly seekers see a hider: an area while still, the exact spot at walking pace
import { SHOT, createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
const waitFor = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const sheet = (id) => `ion-modal.show-modal [data-testid="${id}"]`;
const send = (page, event, payload) => page.evaluate(([e, p]) => window.__manhuntSocket.timeout(4000).emitWithAck(e, p), [event, payload]);
// What reaches the seeker's phone about a player, not just what it shows
const tap = (page) => page.evaluate(() => { window.__states = []; window.__manhuntSocket.on('lobby-state', (s) => window.__states.push(s)); });
const lastSeen = (page, name) => page.evaluate((n) => window.__states.filter((s) => s.phase === 'playing').at(-1)?.players.find((p) => p.name === n) ?? null, name);
const allSeen = (page, name) => page.evaluate((n) => window.__states.filter((s) => s.phase === 'playing')
  .map((s) => s.players.find((p) => p.name === n)).filter((p) => p && p.latitude !== null), name);

const SEEKER = { latitude: 39.19, longitude: -96.58 };
const HIDER = { latitude: 39.1918, longitude: -96.58 };   // 200 m north
const METRES = 111_195;
const metresBetween = (a, b) => Math.hypot((a.latitude - b.latitude) * METRES, (a.longitude - b.longitude) * METRES * Math.cos((a.latitude * Math.PI) / 180));

// --- The host's setting: one row ---
{
  const id = await createLobby('Blur settings');
  const host = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
  check(!/hider/i.test(await text(host.page, '[data-testid="settings-summary"]')), 'the summary row says nothing at the default', await text(host.page, '[data-testid="settings-summary"]'));
  await host.page.locator('[data-testid="settings-row"]').click();
  await host.page.waitForSelector(sheet('hider-blur'));
  await host.page.locator(sheet('hider-blur-note')).scrollIntoViewIfNeeded();
  await host.page.waitForTimeout(400);
  check(await host.page.locator(sheet('hider-blur')).evaluate((s) => s.value) === 100, 'a still hider is shown within 100 m by default');
  check(/slower a hider moves/.test(await text(host.page, sheet('hider-blur-note'))), 'and the note says how it works', await text(host.page, sheet('hider-blur-note')));
  await host.page.screenshot({ path: `${SHOT}/blur-settings.png` });
  await host.page.locator(sheet('hider-blur')).click();
  await host.page.locator('ion-action-sheet:not(.overlay-hidden) button').filter({ hasText: /^Exactly$/ }).click();
  await host.page.waitForTimeout(400);
  check(/always see exactly/.test(await text(host.page, sheet('hider-blur-note'))), 'set to Exactly, the note says so', await text(host.page, sheet('hider-blur-note')));
  await host.page.locator('[data-testid="settings-save"]').click();
  await host.page.waitForTimeout(600);
  check(/Exact hider positions/.test(await text(host.page, '[data-testid="settings-summary"]')), 'and the summary row names the change', await text(host.page, '[data-testid="settings-summary"]'));
  await host.ctx.close();
}

// --- A game at the default: still, walking, stopped ---
{
  const id = await createLobby('Blur game');
  const host = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
  const maya = await join(browser, id, HIDER, { name: 'Maya' });
  await tap(host.page);
  await startGame(host.page, maya.page);

  // Still: an area, on the seeker's phone and on the wire
  check(await waitFor(host.page, () => !!document.querySelector('[data-testid="row-vague"]')), 'a still hider\'s row is marked as an area');
  check(/^±100\sm ·/.test(await text(host.page, '[data-testid="row-vague"]')), 'of 100 m', await text(host.page, '[data-testid="row-vague"]'));
  check(/^≈\s?\d+\s?m$/.test(await text(host.page, '[data-testid="target-distance"]')), 'and the distance is approximate', await text(host.page, '[data-testid="target-distance"]'));
  const still = await lastSeen(host.page, 'Maya');
  const off = metresBetween(still, HIDER);
  check(still.uncertainty_m === 100 && off > 1 && off <= 100, 'the seeker\'s phone is given a point within 100 m of her, not her position', `${off.toFixed(1)} m off, ±${still.uncertainty_m}`);
  check(/Seekers see you within 100\sm/.test(await text(maya.page, '[data-testid="hider-seen"]')), 'the hider is told how she is seen', await text(maya.page, '[data-testid="hider-seen"]'));
  await host.page.screenshot({ path: `${SHOT}/blur-seeker-list.png` });
  await maya.page.screenshot({ path: `${SHOT}/blur-hider-still.png` });

  // The map draws the area
  await host.page.locator('[data-testid="target-card"]').first().click();
  await host.page.waitForSelector('[data-testid="target-readout"]');
  check(/^±100\sm ·/.test(await text(host.page, '[data-testid="target-vague"]')), 'the compass readout says ±100 m', await text(host.page, '[data-testid="target-vague"]'));
  await host.page.locator('[data-testid="track-map-btn"]').click();
  check(await waitFor(host.page, () => !!document.querySelector('[data-testid="track-area"]')), 'the map draws the area she is in');
  await host.page.waitForTimeout(1200);
  await host.page.screenshot({ path: `${SHOT}/blur-seeker-map.png` });

  // She wobbles on the spot for a while: the seeker's point never moves
  for (let i = 0; i < 6; i++) {
    await maya.ctx.setGeolocation({ latitude: HIDER.latitude + (i % 2 ? 0.00003 : -0.00002), longitude: HIDER.longitude + (i % 3 ? 0.00002 : -0.00003) });
    await maya.page.waitForTimeout(1500);
  }
  const points = new Set((await allSeen(host.page, 'Maya')).map((p) => `${p.latitude},${p.longitude}`));
  check(points.size === 1, 'wobbling on the spot, she is one unmoving point to the seeker', `${points.size} points`);

  // She walks north at about 2 m/s. After half a minute of it the seeker has her exact position
  let at = HIDER;
  const walk = async (seconds) => {
    for (let t = 0; t < seconds; t += 2) {
      at = { latitude: at.latitude + (2 * 2) / METRES, longitude: at.longitude };
      await maya.ctx.setGeolocation(at);
      await maya.page.waitForTimeout(2000);
    }
  };
  await walk(20);
  const partway = await lastSeen(host.page, 'Maya');
  check(partway.uncertainty_m > 0, 'twenty seconds of walking is not yet enough to be shown exactly', `±${partway.uncertainty_m}`);
  await walk(26);
  check(await waitFor(host.page, () => !document.querySelector('[data-testid="track-area"]'), null, 12000), 'walking on, the area goes from the map');
  const moving = await lastSeen(host.page, 'Maya');
  // (her phone steadies its fixes, so "exact" is where it says she is, a little behind the test's own figure)
  check(moving.uncertainty_m === 0 && metresBetween(moving, at) < 25, 'and the seeker is given where she really is', `±${moving.uncertainty_m}, ${metresBetween(moving, at).toFixed(1)} m from her`);
  check(/Moving · seekers see exactly where you are/.test(await text(maya.page, '[data-testid="hider-seen"]')), 'the hider is told she is seen exactly', await text(maya.page, '[data-testid="hider-seen"]'));
  check(!/≈/.test(await text(host.page, '[data-testid="target-readout-distance"]')), 'the seeker\'s distance is no longer approximate', await text(host.page, '[data-testid="target-readout-distance"]'));
  await maya.page.screenshot({ path: `${SHOT}/blur-hider-moving.png` });
  await host.page.screenshot({ path: `${SHOT}/blur-seeker-map-exact.png` });

  // She stops. Within a quarter of a minute she is an area again
  check(await waitFor(host.page, () => !!document.querySelector('[data-testid="track-area"]'), null, 25000), 'stopped, she becomes an area again');
  check(await waitFor(maya.page, () => /Seekers see you within/.test(document.querySelector('[data-testid="hider-seen"]')?.innerText || ''), null, 20000), 'and is told so');
  await Promise.all([host, maya].map((p) => p.ctx.close()));
}

// --- Set to exact: no area anywhere ---
{
  const id = await createLobby('Exact game');
  const host = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
  const maya = await join(browser, id, HIDER, { name: 'Maya' });
  await send(host.page, 'update-settings', { settings: { hider_blur_m: 0 } });
  await tap(host.page);
  await startGame(host.page, maya.page);
  check(await waitFor(host.page, () => /^2\d\d\s?m$/.test(document.querySelector('[data-testid="target-distance"]')?.innerText || '')), 'in an exact game the seeker sees a still hider\'s real distance', await text(host.page, '[data-testid="target-distance"]'));
  const seen = await lastSeen(host.page, 'Maya');
  check(seen.uncertainty_m === 0 && seen.latitude === HIDER.latitude, 'and is given her real position');
  check(await host.page.locator('[data-testid="row-vague"]').count() === 0, 'with no ± on her row');
  await maya.page.waitForSelector('[data-testid="seeker-info"]');
  check(await maya.page.locator('[data-testid="hider-seen"]').count() === 0, 'and the hider has no line about it');
  await Promise.all([host, maya].map((p) => p.ctx.close()));
}

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
