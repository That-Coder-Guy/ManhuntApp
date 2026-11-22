// Jamming: the host's settings, the hider's jammer, and what a seeker sees of a jammed hider
import { SHOT, createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
const waitFor = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const sheet = (id) => `ion-modal.show-modal [data-testid="${id}"]`;
const pick = async (page, id, label) => {
  await page.locator(sheet(id)).click();
  // (the whole label: "5 min" is also in "15 min")
  await page.locator('ion-action-sheet:not(.overlay-hidden) button').filter({ hasText: new RegExp(`^${label}$`) }).click();
  await page.waitForTimeout(400);
};
const jamState = (page) => page.locator('[data-testid="jam-card"]').getAttribute('data-state').catch(() => null);
const jamIs = (page, state, timeout) => waitFor(page, (s) => document.querySelector('[data-testid="jam-card"]')?.dataset.state === s, state, timeout);
// What the server holds for the lobby, through the host's socket
const send = (page, event, payload) => page.evaluate(([e, p]) => window.__manhuntSocket.timeout(4000).emitWithAck(e, p), [event, payload]);

const SEEKER = { latitude: 39.19, longitude: -96.58 };
const HIDER = { latitude: 39.1909, longitude: -96.58 };      // ~100 m north
const HIDER_MOVED = { latitude: 39.1945, longitude: -96.58 }; // ~500 m north
const seekerDistance = (page) => text(page, '[data-testid="target-distance"]');

// --- The settings sheet: one section, and only a switch while jamming is off ---
{
  const id = await createLobby('Jam settings');
  const host = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
  const guest = await join(browser, id, HIDER, { name: 'Maya' });

  check(!/jam/i.test(await text(host.page, '[data-testid="settings-summary"]')), 'the summary row says nothing about jamming at its defaults', await text(host.page, '[data-testid="settings-summary"]'));
  await host.page.locator('[data-testid="settings-row"]').click();
  await host.page.waitForSelector(sheet('jam-toggle'));
  await host.page.locator(sheet('jam-note')).scrollIntoViewIfNeeded();
  await host.page.waitForTimeout(400);
  check(await host.page.locator(sheet('jam-toggle')).evaluate((t) => t.checked), 'jamming is on by default');
  const chosen = (page, id) => page.locator(sheet(id)).evaluate((select) => select.value);
  check(await chosen(host.page, 'jam-duration') === 60, 'a jam lasts 60 seconds by default', String(await chosen(host.page, 'jam-duration')));
  check(await chosen(host.page, 'jam-charge') === 15, 'and takes 15 minutes to charge', String(await chosen(host.page, 'jam-charge')));
  await host.page.screenshot({ path: `${SHOT}/jam-settings-on.png` });

  // Off: the two times go, leaving the switch and one line
  await host.page.locator(sheet('jam-toggle')).click();
  await host.page.waitForTimeout(400);
  check(await host.page.locator(sheet('jam-duration')).count() === 0 && await host.page.locator(sheet('jam-charge')).count() === 0, 'turned off, its two settings are not shown');
  check(/track every hider/.test(await text(host.page, sheet('jam-note'))), 'and the note says what off means', await text(host.page, sheet('jam-note')));
  await host.page.locator(sheet('jam-note')).scrollIntoViewIfNeeded();
  await host.page.screenshot({ path: `${SHOT}/jam-settings-off.png` });

  // Back on with other times: saved, and everyone sees them
  await host.page.locator(sheet('jam-toggle')).click();
  await host.page.waitForTimeout(400);
  await pick(host.page, 'jam-duration', '30 s');
  await pick(host.page, 'jam-charge', '5 min');
  await host.page.locator('[data-testid="settings-save"]').click();
  await host.page.waitForTimeout(600);
  check(/30 s jam, 5 min charge/.test(await text(host.page, '[data-testid="settings-summary"]')), 'changed, the summary row says so', await text(host.page, '[data-testid="settings-summary"]'));
  check(await waitFor(guest.page, () => /30 s jam, 5 min charge/.test(document.querySelector('[data-testid="settings-summary"]')?.innerText || '')), 'on every phone');
  await guest.page.locator('[data-testid="settings-row"]').click();
  await guest.page.waitForSelector(sheet('jam-toggle'));
  check(await guest.page.locator(sheet('jam-toggle')).getAttribute('aria-disabled') === 'true', 'only the host can change it');
  await Promise.all([host, guest].map((p) => p.ctx.close()));
}

// --- A game: charge, jam, the seeker's frozen view, and the end of the jam ---
{
  const id = await createLobby('Jam game');
  const host = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
  const maya = await join(browser, id, HIDER, { name: 'Maya' });
  // The shortest times the server allows, so the test needn't wait fifteen minutes
  // (and exact positions, so the distances below are the real ones)
  const saved = await send(host.page, 'update-settings', { settings: { jam_duration_s: 10, jam_charge_s: 10, hider_blur_m: 0 } });
  check(saved.status === 'success', 'ten-second times are within the limits', JSON.stringify(saved));
  await startGame(host.page, maya.page);

  check(await jamIs(maya.page, 'charging'), 'the hider gets a jammer, charging', await jamState(maya.page));
  check(/Charging · ready in 0:\d\d/.test(await text(maya.page, '[data-testid="jam-status"]')), 'with a countdown', await text(maya.page, '[data-testid="jam-status"]'));
  check(await maya.page.locator('[data-testid="jam-btn"]').evaluate((b) => b.classList.contains('button-disabled') || b.hasAttribute('disabled')), 'and a Jam button that waits');
  check(await host.page.locator('[data-testid="jam-card"]').count() === 0, 'seekers have no jammer');
  await maya.page.screenshot({ path: `${SHOT}/jam-hider-charging.png` });
  check(await waitFor(host.page, () => /^1\d\d\s?m$/.test(document.querySelector('[data-testid="target-distance"]')?.innerText || '')), 'the seeker tracks Maya, ~100 m off', await seekerDistance(host.page));

  check(await jamIs(maya.page, 'ready', 15000), 'ten seconds on, it is ready');
  check(/Ready · hides you for 10 s/.test(await text(maya.page, '[data-testid="jam-status"]')), 'and says what it does', await text(maya.page, '[data-testid="jam-status"]'));
  await maya.page.screenshot({ path: `${SHOT}/jam-hider-ready.png` });

  await maya.page.locator('[data-testid="jam-btn"]').click();
  check(await jamIs(maya.page, 'active'), 'one tap starts the jam');
  check(/Hidden from seekers · 0:\d\d left/.test(await text(maya.page, '[data-testid="jam-status"]')), 'with the time left', await text(maya.page, '[data-testid="jam-status"]'));
  await maya.page.screenshot({ path: `${SHOT}/jam-hider-active.png` });

  // The seeker is told, and the row says jammed
  check(await waitFor(host.page, () => [...document.querySelectorAll('ion-toast')].some((t) => /Maya is jamming your tracking/.test(t.message))), 'the seeker is told Maya is jamming');
  check(await waitFor(host.page, () => !!document.querySelector('[data-testid="row-jammed"]')), 'and her row is marked Jammed');
  // Maya runs 400 m: the seeker's number doesn't follow
  await maya.ctx.setGeolocation(HIDER_MOVED);
  await host.page.waitForTimeout(3500);
  check(/^1\d\d\s?m$/.test(await seekerDistance(host.page)), 'while jammed, the seeker keeps the old distance', await seekerDistance(host.page));
  check(/Jammed ·\s+seen/.test((await text(host.page, '[data-testid="target-card"] .player-freshness')).replace(/\n/g, ' ')), 'with when she was last seen', await text(host.page, '[data-testid="target-card"] .player-freshness'));
  await host.page.screenshot({ path: `${SHOT}/jam-seeker-list.png` });
  await host.page.locator('[data-testid="target-card"]').first().click();
  await host.page.waitForSelector('[data-testid="target-readout"]');
  check(/Jammed · last seen/.test(await text(host.page, '[data-testid="target-jammed"]')), 'the compass screen says so too', await text(host.page, '[data-testid="target-jammed"]'));
  await host.page.waitForTimeout(500);
  await host.page.screenshot({ path: `${SHOT}/jam-seeker-compass.png` });
  await host.page.locator('[data-testid="compass-back"]').click();

  // It runs out: the seeker gets the real position, the hider charges again
  check(await waitFor(host.page, () => !document.querySelector('[data-testid="row-jammed"]'), null, 15000), 'when the jam ends the mark goes');
  check(await waitFor(host.page, () => /^[345]\d\d\s?m$/.test(document.querySelector('[data-testid="target-distance"]')?.innerText || '')), 'and the seeker sees where Maya really is now (hundreds of metres on; her fixes are steadied)', await seekerDistance(host.page));
  check(await jamIs(maya.page, 'charging'), 'the jammer charges again');
  const refused = await send(maya.page, 'jam', {});
  check(refused.status === 'charging', 'and the server agrees it isn\'t ready', JSON.stringify(refused));
  await Promise.all([host, maya].map((p) => p.ctx.close()));
}

// --- Turned off: no jammer on a hider's screen ---
{
  const id = await createLobby('No jam');
  const host = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
  const maya = await join(browser, id, HIDER, { name: 'Maya' });
  await send(host.page, 'update-settings', { settings: { jam_enabled: false } });
  await startGame(host.page, maya.page);
  await maya.page.waitForSelector('[data-testid="seeker-info"]');
  await maya.page.waitForTimeout(800);
  check(await maya.page.locator('[data-testid="jam-card"]').count() === 0, 'with jamming off, the hider has no jammer');
  check((await send(maya.page, 'jam', {})).status === 'jam_off', 'and the server refuses one');
  await maya.page.screenshot({ path: `${SHOT}/jam-hider-off.png` });
  await Promise.all([host, maya].map((p) => p.ctx.close()));
}

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
