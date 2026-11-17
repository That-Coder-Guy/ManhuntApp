// What hiders see about the seekers, in each of the host's three modes
import { SHOT, createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
const waitFor = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const valueIs = (page, re) => waitFor(page, (src) => new RegExp(src).test(document.querySelector('[data-testid="seeker-info-value"]')?.innerText || ''), re.source);

const SEEKER = { latitude: 39.19, longitude: -96.58 };
const NEAR = { latitude: 39.1903, longitude: -96.58 };   // ~33 m
const FAR = { latitude: 39.192, longitude: -96.58 };     // ~222 m

// Watch what actually reaches a phone, not just what it shows
const tap = (page) => page.evaluate(() => { window.__states = []; window.__manhuntSocket.on('lobby-state', (s) => window.__states.push(s)); });
const leaked = (page) => page.evaluate(() => window.__states.filter((s) => s.phase === 'playing')
  .flatMap((s) => s.players).filter((p) => p.latitude !== null && p.name !== window.__me).length);

async function game(name, mode, alert) {
  const id = await createLobby(name);
  const host = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
  const near = await join(browser, id, NEAR, { name: 'Maya' });
  const far = await join(browser, id, FAR, { name: 'Priya' });
  if (mode) {
    await host.page.locator('[data-testid="settings-row"]').click();
    await host.page.waitForSelector('ion-modal.show-modal [data-testid="seeker-info-mode"]');
    await host.page.locator('ion-modal.show-modal [data-testid="seeker-info-mode"]').click();
    await host.page.locator(`ion-action-sheet:not(.overlay-hidden) button:has-text("${mode}")`).click();
    await host.page.waitForTimeout(400);
    if (alert) {
      await host.page.locator('ion-modal.show-modal [data-testid="seeker-alert"]').click();
      await host.page.locator(`ion-action-sheet:not(.overlay-hidden) button:has-text("${alert}")`).click();
      await host.page.waitForTimeout(400);
    }
    await host.page.screenshot({ path: `${SHOT}/info-settings-${name}.png` });
    await host.page.locator('[data-testid="settings-save"]').click();
    await host.page.waitForTimeout(500);
  }
  for (const p of [near.page, far.page]) { await tap(p); await p.evaluate((n) => { window.__me = n; }, p === near.page ? 'Maya' : 'Priya'); }
  await startGame(host.page, near.page, far.page);
  await host.page.waitForTimeout(1500);
  return { host, near, far };
}

// --- Default: distance to the nearest seeker ---
{
  const { host, near, far } = await game('distance');
  check(await valueIs(near.page, /^3\d\s?m$/), 'distance: Maya sees ~33 m', await text(near.page, '[data-testid="seeker-info-value"]'));
  check(await valueIs(far.page, /^22\d\s?m$/), 'distance: Priya sees ~222 m', await text(far.page, '[data-testid="seeker-info-value"]'));
  check(/stay out of sight/.test(await text(near.page, '[data-testid="seeker-info-caption"]')), 'a close seeker is flagged');
  check(/A seeker is 3\d\sm away/.test(await text(near.page, '[data-testid="found-hint"]')), 'found hint uses the distance', await text(near.page, '[data-testid="found-hint"]'));
  check(await far.page.locator('[data-testid="found-btn"]').evaluate((b) => b.classList.contains('button-disabled') || b.hasAttribute('disabled')), 'out of range: Found is disabled');
  check(await leaked(near.page) === 0 && await leaked(far.page) === 0, "no one else's coordinates reach a hider's phone");
  check(await host.page.locator('[data-testid="target-card"]').count() >= 2, 'seekers still track the hiders');
  // The seeker walks closer: Priya's number follows
  await host.ctx.setGeolocation({ latitude: 39.1915, longitude: -96.58 });
  check(await valueIs(far.page, /^5\d\s?m$/), 'the distance follows the seeker', await text(far.page, '[data-testid="seeker-info-value"]'));
  await near.page.screenshot({ path: `${SHOT}/info-hider-distance.png` });
  await far.page.screenshot({ path: `${SHOT}/info-hider-distance-far.png` });
  await Promise.all([host, near, far].map((p) => p.ctx.close()));
}

// --- Nearby alert at 100 m ---
{
  const { host, near, far } = await game('nearby', 'Nearby alert', '100');
  check(await valueIs(near.page, /^Seeker nearby$/), 'alert: Maya (33 m) is warned', await text(near.page, '[data-testid="seeker-info-value"]'));
  check(await valueIs(far.page, /^All clear$/), 'alert: Priya (222 m) is all clear', await text(far.page, '[data-testid="seeker-info-value"]'));
  check(/within 100\sm/.test(await text(far.page, '[data-testid="seeker-info-caption"]')), 'and told the alert distance', await text(far.page, '[data-testid="seeker-info-caption"]'));
  check(!/\d+\s?m away/.test(await far.page.locator('ion-content').innerText()), 'no distance shown anywhere');
  const farBtn = far.page.locator('[data-testid="found-btn"]');
  check(!(await farBtn.evaluate((b) => b.classList.contains('button-disabled') || b.hasAttribute('disabled'))), "Found stays tappable (it mustn't hint at distance)");
  await far.page.screenshot({ path: `${SHOT}/info-hider-clear.png` });
  await near.page.screenshot({ path: `${SHOT}/info-hider-nearby.png` });
  // Priya taps Found while out of range: the server refuses
  await farBtn.click();
  await far.page.waitForSelector('ion-alert.found-alert');
  await far.page.locator('ion-alert.found-alert button:has-text("I’ve been found")').click();
  check(await waitFor(far.page, () => [...document.querySelectorAll('ion-toast')].some((t) => /within 50 m/.test(t.message))), 'out of range, the server says no');
  // The seeker closes in: Priya is alerted
  await host.ctx.setGeolocation({ latitude: 39.1915, longitude: -96.58 });
  check(await valueIs(far.page, /^Seeker nearby$/), 'the alert comes on as a seeker closes in');
  check(await leaked(near.page) === 0 && await leaked(far.page) === 0, "no coordinates reach a hider's phone");
  await Promise.all([host, near, far].map((p) => p.ctx.close()));
}

// --- Nothing ---
{
  const { host, near } = await game('none', 'Nothing');
  check(await valueIs(near.page, /^Stay sharp$/), 'nothing: the hider is told seeker info is off', await text(near.page, '[data-testid="seeker-info-value"]'));
  check(/Tap once a seeker is within 50\sm/.test(await text(near.page, '[data-testid="found-hint"]')), 'found hint gives nothing away', await text(near.page, '[data-testid="found-hint"]'));
  await near.page.screenshot({ path: `${SHOT}/info-hider-none.png` });
  // Caught for real: Found works, the server checks the distance
  await near.page.locator('[data-testid="found-btn"]').click();
  await near.page.waitForSelector('ion-alert.found-alert');
  await near.page.locator('ion-alert.found-alert button:has-text("I’ve been found")').click();
  check(await waitFor(near.page, () => document.querySelector('[data-testid="game-role"]')?.innerText === 'Seeker'), 'a caught hider can still be found');
  await Promise.all([host, near].map((p) => p.ctx.close()));
}

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
