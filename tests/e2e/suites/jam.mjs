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
  // One list at a time: the last one takes a moment to close
  await page.waitForFunction(() => !document.querySelector('ion-action-sheet:not(.overlay-hidden)'), null, { timeout: 5000 }).catch(() => {});
  await page.locator(sheet(id)).click();
  // (the whole label: "5 min" is also in "15 min")
  await page.locator('ion-action-sheet:not(.overlay-hidden) button').filter({ hasText: new RegExp(`^${label}$`) }).click();
  await page.waitForTimeout(400);
};
// The jammer is in the Abilities menu, under a button on the game screen; the button says how it stands without being opened
const jamState = (page) => page.locator('[data-testid="abilities-btn"]').getAttribute('data-state').catch(() => null);
const jamIs = (page, state, timeout) => waitFor(page, (s) => document.querySelector('[data-testid="abilities-btn"]')?.dataset.state === s, state, timeout);
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

  check(await jamIs(maya.page, 'charging'), 'the hider gets an Abilities button, its jammer charging', await jamState(maya.page));
  const button = await maya.page.evaluate(() => {
    const b = document.querySelector('[data-testid="abilities-btn"]');
    const r = b.getBoundingClientRect();
    const clock = document.querySelector('[data-testid="game-role"]').closest('ion-card, ion-item, .name-card, div').getBoundingClientRect();
    return { text: b.innerText.replace(/\s+/g, ' ').trim(), inContent: !!b.closest('ion-content'), inToolbar: !!b.closest('ion-header'),
      top: r.top, left: r.left, right: r.right, view: window.innerWidth, clockTop: clock.top };
  });
  check(/^Abilities Jammer charging · 0:\d\d$/.test(button.text), 'it reads Abilities, and says how the jammer stands', button.text);
  check(button.inContent && !button.inToolbar && button.top > button.clockTop && button.left >= 0 && button.right <= button.view, 'on the game screen itself, under the clock, not in the toolbar', JSON.stringify(button));
  const bar = await maya.page.locator('ion-header ion-buttons ion-button').evaluateAll((buttons) => buttons.map((b) => b.dataset.testid));
  check(JSON.stringify(bar) === JSON.stringify(['chat-btn', 'players-btn', 'menu-btn']), 'the toolbar stays chat, players, menu', JSON.stringify(bar));
  check(await maya.page.locator('[data-testid="jam-card"]').count() === 0, 'the jammer itself is not on the screen until the menu is opened');
  await maya.page.locator('[data-testid="abilities-btn"]').click();
  await maya.page.waitForSelector('ion-popover.abilities-menu [data-testid="jam-card"]');
  await maya.page.waitForTimeout(400);
  check(/Hider abilities/.test(await text(maya.page, 'ion-popover.abilities-menu .abilities-title')), 'pressing it opens the Abilities menu, with the jammer in it', await text(maya.page, 'ion-popover.abilities-menu .abilities'));
  check(/Charging · ready in 0:\d\d/.test(await text(maya.page, '[data-testid="jam-status"]')), 'with a countdown', await text(maya.page, '[data-testid="jam-status"]'));
  check(await maya.page.locator('[data-testid="jam-btn"]').evaluate((b) => b.classList.contains('button-disabled') || b.hasAttribute('disabled')), 'and a Jam button that waits');
  check(await host.page.locator('[data-testid="abilities-btn"], [data-testid="jam-card"]').count() === 0, 'seekers have no abilities yet, so no button');
  await maya.page.screenshot({ path: `${SHOT}/jam-hider-charging.png` });
  check(await waitFor(host.page, () => /^1\d\d\s?m$/.test(document.querySelector('[data-testid="target-distance"]')?.innerText || '')), 'the seeker tracks Maya, ~100 m off', await seekerDistance(host.page));

  // The seeker is on her, compass open, when she jams
  await host.page.evaluate(() => { window.__states = []; window.__manhuntSocket.on('lobby-state', (s) => window.__states.push(s)); });
  await host.page.locator('[data-testid="target-card"]').first().click();
  await host.page.waitForSelector('[data-testid="compass-screen"]');

  check(await jamIs(maya.page, 'ready', 15000), 'ten seconds on, it is ready');
  check(/Ready · hides you for 10 s/.test(await text(maya.page, '[data-testid="jam-status"]')), 'and says what it does', await text(maya.page, '[data-testid="jam-status"]'));
  check(await text(maya.page, '[data-testid="abilities-status"]') === 'Jammer ready', 'and the Abilities button says it is ready', await text(maya.page, '[data-testid="abilities-status"]'));
  await maya.page.screenshot({ path: `${SHOT}/jam-hider-ready.png` });

  await maya.page.locator('[data-testid="jam-btn"]').click();
  check(await jamIs(maya.page, 'active'), 'one tap starts the jam');
  check(await maya.page.locator('ion-popover.abilities-menu [data-testid="jam-card"]').count() === 1, 'the menu stays open, so she sees it take');
  check(/Hidden from seekers · 0:\d\d left/.test(await text(maya.page, '[data-testid="jam-status"]')), 'with the time left', await text(maya.page, '[data-testid="jam-status"]'));
  check(/^Jamming · 0:\d\d left$/.test(await text(maya.page, '[data-testid="abilities-status"]')), 'and the Abilities button says so too', await text(maya.page, '[data-testid="abilities-status"]'));
  await maya.page.screenshot({ path: `${SHOT}/jam-hider-active.png` });

  // With the menu closed, her own screen still says she is hidden, and for how long
  await maya.page.mouse.click(60, 700);
  check(await waitFor(maya.page, () => !document.querySelector('ion-popover.abilities-menu [data-testid="jam-card"]')), 'tapping away closes the menu');
  check(/Jamming · hidden from seekers for 0:\d\d/.test(await text(maya.page, '[data-testid="hider-seen"]')), 'and her screen says she is hidden, with the time left', await text(maya.page, '[data-testid="hider-seen"]'));
  await maya.page.screenshot({ path: `${SHOT}/jam-hider-screen.png` });

  // The seeker, who was tracking her on the compass, is told, and she is gone:
  // back to the list, with her not on it
  check(await waitFor(host.page, () => [...document.querySelectorAll('ion-toast')].some((t) => /Maya is jamming: gone from your tracking/.test(t.message))), 'the seeker is told Maya is jamming');
  check(await waitFor(host.page, () => !document.querySelector('[data-testid="compass-screen"]')), 'the seeker\'s compass, which was on her, closes');
  check(await waitFor(host.page, () => document.querySelectorAll('[data-testid="target-card"]').length === 0), 'and she is gone from the seeker\'s list of hiders');
  check(/No hider can be tracked right now/.test(await text(host.page, '[data-testid="no-targets"]')), 'which says there is no one to track', await text(host.page, '[data-testid="no-targets"]'));
  await host.page.screenshot({ path: `${SHOT}/jam-seeker-list.png` });
  // Maya runs 400 m. Nothing about where she is, or was, reaches the seeker's phone
  await maya.ctx.setGeolocation(HIDER_MOVED);
  await host.page.waitForTimeout(3500);
  const during = await host.page.evaluate(() => window.__states.at(-1).players.find((p) => p.name === 'Maya'));
  check(during.jammed_until > 0 && during.latitude === null && during.longitude === null && during.location_last_updated === null && during.uncertainty_m === null,
    'the seeker\'s phone is sent no position for her at all', JSON.stringify(during));
  const leaked = await host.page.evaluate((after) => window.__states.filter((s) => s.server_time >= after).some((s) => s.players.some((p) => p.name === 'Maya' && p.latitude !== null)), during.jammed_until - 10_000);
  check(!leaked, 'at no point during the jam');
  check(await host.page.locator('[data-testid="target-card"]').count() === 0, 'and she stays off the list');
  // The list of everyone in the lobby still has her: she hasn't left the game
  await host.page.locator('[data-testid="players-btn"]').click();
  await host.page.waitForSelector('ion-modal.show-modal');
  await host.page.waitForTimeout(400);
  check(/Maya[\s\S]*Jamming/.test(await text(host.page, 'ion-modal.show-modal')), 'the lobby\'s list of players still has her, as jamming', (await text(host.page, 'ion-modal.show-modal')).replace(/\s+/g, ' ').slice(0, 120));
  await host.page.locator('ion-modal.show-modal ion-button', { hasText: 'Close' }).click();
  await host.page.waitForSelector('ion-modal.show-modal', { state: 'detached', timeout: 5000 }).catch(() => {});

  // It runs out: she is back on the list, where she really is now, and the hider charges again
  check(await waitFor(host.page, () => document.querySelectorAll('[data-testid="target-card"]').length === 1, null, 15000), 'when the jam ends she is back on the seeker\'s list');
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
  check(await maya.page.locator('[data-testid="abilities-btn"], [data-testid="jam-card"]').count() === 0, 'with jamming off, the hider has no jammer, and no Abilities button');
  check((await send(maya.page, 'jam', {})).status === 'jam_off', 'and the server refuses one');
  await maya.page.screenshot({ path: `${SHOT}/jam-hider-off.png` });
  await Promise.all([host, maya].map((p) => p.ctx.close()));
}

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
