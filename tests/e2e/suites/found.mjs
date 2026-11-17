// Found flow end to end: host sets the range, hiders declare themselves found,
// the last find ends the game for everyone, and only the host can go back
import { SHOT, createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
const waitFor = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const shot = (page, name) => page.screenshot({ path: `${SHOT}/found-${name}.png` });

const SEEKER = { latitude: 39.19, longitude: -96.58 };
const NEAR = { latitude: 39.1903, longitude: -96.58 };   // ~33 m
const FAR = { latitude: 39.192, longitude: -96.58 };     // ~222 m

const id = await createLobby('Riverside Park');
const host = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
const near = await join(browser, id, NEAR, { name: 'Maya' });
const far = await join(browser, id, FAR, { name: 'Priya' });
await host.page.waitForTimeout(800);

// --- The host sets the found range in the lobby ---
await host.page.locator('[data-testid="settings-row"]').click();
await host.page.waitForSelector('ion-modal.show-modal [data-testid="found-range"]');
await host.page.locator('ion-modal.show-modal [data-testid="found-range"]').click();
await host.page.locator('ion-action-sheet:not(.overlay-hidden) button:has-text("75")').click();
await host.page.waitForTimeout(400);
await shot(host.page, 'settings');
await host.page.locator('[data-testid="settings-save"]').click();
const summaryOk = await waitFor(host.page, () => /found ≤ 75\u202Fm/.test(document.querySelector('[data-testid="settings-summary"]')?.innerText || ''));
check(summaryOk, 'host sets "Found within 75 m"; the summary shows it', await text(host.page, '[data-testid="settings-summary"]'));
check(await waitFor(near.page, () => /75/.test(document.querySelector('[data-testid="settings-summary"]')?.innerText || '')), 'guests see the new range');

// --- In game: only hiders get the button, unlocked in range ---
await startGame(host.page, near.page, far.page);
await host.page.waitForTimeout(1500);
check(await host.page.locator('[data-testid="found-btn"]').count() === 0, 'seekers have no Found button');
const nearReady = await waitFor(near.page, () => !document.querySelector('[data-testid="found-btn"]')?.hasAttribute('disabled')
  && !document.querySelector('[data-testid="found-btn"]')?.classList.contains('button-disabled'));
check(nearReady, 'hider 33 m away: Found is enabled');
check(/A seeker is 3\d\u202Fm away/.test(await text(near.page, '[data-testid="found-hint"]')), 'and says how close the seeker is', await text(near.page, '[data-testid="found-hint"]'));
const farDisabled = await far.page.locator('[data-testid="found-btn"]').evaluate((b) => b.classList.contains('button-disabled') || b.hasAttribute('disabled'));
check(farDisabled, 'hider 222 m away: Found is disabled');
check(/22\d\u202Fm away · unlocks within 75\u202Fm/.test(await text(far.page, '[data-testid="found-hint"]')), 'and says how far and when it unlocks', await text(far.page, '[data-testid="found-hint"]'));
await shot(near.page, 'hider-in-range');
await shot(far.page, 'hider-out-of-range');

// --- Maya is found: confirm, she joins the seekers, everyone is told ---
await near.page.locator('[data-testid="found-btn"]').click();
await near.page.waitForSelector('ion-alert.found-alert');
await shot(near.page, 'confirm');
const hostToast = host.page.waitForFunction(() => [...document.querySelectorAll('ion-toast.found-toast')].some((t) => /Maya was found · 1 hider left/.test(t.message)), null, { timeout: 8000 }).then(() => true, () => false);
await near.page.locator('ion-alert.found-alert button:has-text("I’ve been found")').click();
check(await waitFor(near.page, () => document.querySelector('[data-testid="game-role"]')?.innerText === 'Seeker'), 'Maya becomes a seeker');
check(await near.page.locator('[data-testid="found-btn"]').count() === 0, 'and loses the Found button');
check(await hostToast, 'the host is told "Maya was found · 1 hider left"');
check(await waitFor(host.page, () => ![...document.querySelectorAll('[data-testid="target-card"]')].some((r) => /Maya/.test(r.innerText))), "Maya leaves the seekers' hider list");
check(await host.page.locator('[data-phase="playing"]').count() === 1, 'one hider still out: the game goes on');

// --- Priya walks up to a seeker and is found: the game ends for everyone ---
await far.ctx.setGeolocation(NEAR);
check(await waitFor(far.page, () => { const b = document.querySelector('[data-testid="found-btn"]'); return b && !b.classList.contains('button-disabled'); }, null, 12000),
  'Priya walks within range: Found unlocks');
await far.page.locator('[data-testid="found-btn"]').click();
await far.page.waitForSelector('ion-alert.found-alert');
await far.page.locator('ion-alert.found-alert button:has-text("I’ve been found")').click();
for (const [who, p] of [['host', host.page], ['Maya', near.page], ['Priya', far.page]]) {
  check(await waitFor(p, () => document.querySelector('[data-phase="ended"]')), `${who} sees the game-over screen`);
}
check((await text(host.page, '[data-testid="game-over-result"]')) === 'Everyone was found. The seekers win.', 'it says everyone was found', await text(host.page, '[data-testid="game-over-result"]'));
const found = await near.page.locator('[data-testid="found-list"] li').allInnerTexts();
check(found.length === 2 && /Maya/.test(found[0]) && /Priya/.test(found[1]), 'and lists who was found, in order', JSON.stringify(found));
check(await host.page.locator('[data-testid="reset-game"]').count() === 1, 'only the host has "Back to the lobby"');
check(await near.page.locator('[data-testid="reset-game"]').count() === 0 && await far.page.locator('[data-testid="reset-game"]').count() === 0, 'guests do not');
check(/Waiting for Hank to go back to the lobby/.test(await text(near.page, '[data-testid="waiting-for-host"]')), 'guests are told who they wait for', await text(near.page, '[data-testid="waiting-for-host"]'));
await near.page.waitForTimeout(4000); // the screen stays put, the toast fades
check(await near.page.locator('[data-phase="ended"]').count() === 1, 'the results stay up until the host acts');
await shot(host.page, 'game-over-host');
await shot(near.page, 'game-over-guest');

// --- The host brings everyone back; starting roles return ---
await host.page.locator('[data-testid="reset-game"]').click();
for (const [who, p] of [['host', host.page], ['Maya', near.page], ['Priya', far.page]]) {
  check(await waitFor(p, () => document.querySelector('[data-phase="lobby"]')), `${who} is back in the pregame lobby`);
}
const roleOf = (p) => p.locator('ion-segment-button.segment-button-checked').innerText();
check((await roleOf(near.page)).trim() === 'Hider' && (await roleOf(far.page)).trim() === 'Hider', 'Maya and Priya are hiders again', `${await roleOf(near.page)} / ${await roleOf(far.page)}`);
check((await roleOf(host.page)).trim() === 'Seeker', 'Hank is still the seeker');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
