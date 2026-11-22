// The lobby toolbar's menu: inviting, leaving and (for the host) ending the game share one button
import { BASE, SHOT, createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const waitFor = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const toolbar = (page) => page.locator('ion-header ion-buttons ion-button').evaluateAll((buttons) => buttons.map((b) => b.dataset.testid));
const openMenu = async (page) => {
  await page.locator('[data-testid="menu-btn"]').click();
  await page.waitForSelector('ion-popover.lobby-menu [data-testid="invite-btn"]');
  await page.waitForTimeout(400);
};
const menuGone = (page) => waitFor(page, () => !document.querySelector('ion-popover.lobby-menu [data-testid="invite-btn"]'));

const HERE = { latitude: 39.19, longitude: -96.58 };
const id = await createLobby('The Long Meadow Evening Game'); // long enough to reach the buttons
const hank = await join(browser, id, HERE, { name: 'Hank', host: true, seeker: true });
const maya = await join(browser, id, { latitude: 39.1903, longitude: -96.58 }, { name: 'Maya' });

const clearOfButtons = (page) => page.evaluate(() => {
  // The title is as wide as the bar; its padding is what keeps the name clear of the buttons
  const el = document.querySelector('[data-testid="lobby-title"]');
  const first = document.querySelector('ion-header ion-buttons ion-button').getBoundingClientRect();
  return { titleRight: el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight), firstButton: first.left };
});
// --- The toolbar: chat, players, and one button for the rest ---
check(JSON.stringify(await toolbar(maya.page)) === JSON.stringify(['chat-btn', 'players-btn', 'menu-btn']), 'the toolbar has chat, players and a menu button', JSON.stringify(await toolbar(maya.page)));
check(await maya.page.locator('[data-testid="invite-btn"], [data-testid="leave-btn"]').count() === 0, 'invite and leave are not on it');
check(/invite/i.test(await maya.page.locator('[data-testid="menu-btn"]').getAttribute('aria-label')), 'the menu button says what is in it');
const threeButtons = await clearOfButtons(maya.page);
check(threeButtons.titleRight <= threeButtons.firstButton + 1, 'a long lobby name stops short of the buttons', JSON.stringify(threeButtons));

// --- The menu: under its button, with both ---
await openMenu(maya.page);
const menu = await maya.page.evaluate(() => {
  const box = document.querySelector('ion-popover.lobby-menu').shadowRoot.querySelector('.popover-content').getBoundingClientRect();
  const button = document.querySelector('[data-testid="menu-btn"]').getBoundingClientRect();
  return { items: [...document.querySelectorAll('ion-popover.lobby-menu ion-item')].map((item) => item.innerText.trim()),
    left: box.left, right: box.right, top: box.top, buttonBottom: button.bottom, buttonRight: button.right, view: window.innerWidth };
});
check(JSON.stringify(menu.items) === JSON.stringify(['Invite players', 'Leave lobby']), 'pressing it opens a menu: Invite players, Leave lobby', JSON.stringify(menu.items));
check(menu.left >= 0 && menu.right <= menu.view && menu.top >= menu.buttonBottom - 4 && Math.abs(menu.right - menu.buttonRight) < 24, 'which opens under the button, on screen', JSON.stringify(menu));
await maya.page.screenshot({ path: `${SHOT}/lobby-menu.png` });

// --- Invite players ---
await maya.page.locator('[data-testid="invite-btn"]').click();
check(await waitFor(maya.page, () => !!document.querySelector('ion-modal.show-modal [data-testid="share-qr-img"]')), 'Invite players opens the invite');
check(await menuGone(maya.page), 'and the menu closes behind it');
await maya.page.locator('ion-modal.show-modal [data-testid="share-close"]').click();
await maya.page.waitForSelector('ion-modal.show-modal', { state: 'detached', timeout: 5000 }).catch(() => {});

// --- Tapping away closes it, with nothing done ---
await openMenu(maya.page);
await maya.page.mouse.click(60, 600);
check(await menuGone(maya.page) && await maya.page.locator('[data-testid="lobby-page"]').count() === 1, 'tapping away closes the menu');

// --- The host before a game has the same two; nothing to end yet ---
await openMenu(hank.page);
check(await hank.page.locator('ion-popover.lobby-menu ion-item').count() === 2 && await hank.page.locator('[data-testid="end-game-btn"]').count() === 0, 'before a game the host\'s menu has no End game');
await hank.page.mouse.click(60, 600);
await menuGone(hank.page);

// --- During a game: the host's menu gains End game, between the two; the toolbar stays as it was ---
await startGame(hank.page, maya.page);
check(JSON.stringify(await toolbar(hank.page)) === JSON.stringify(['chat-btn', 'players-btn', 'menu-btn']), 'in a game the host\'s toolbar is still chat, players and the menu', JSON.stringify(await toolbar(hank.page)));
const items = (page) => page.locator('ion-popover.lobby-menu ion-item').evaluateAll((list) => list.map((item) => item.innerText.trim()));
await openMenu(hank.page);
check(JSON.stringify(await items(hank.page)) === JSON.stringify(['Invite players', 'End game', 'Leave lobby']), 'and the host\'s menu has End game', JSON.stringify(await items(hank.page)));
await hank.page.screenshot({ path: `${SHOT}/lobby-menu-host.png` });
await hank.page.mouse.click(60, 600);
await menuGone(hank.page);
await openMenu(maya.page);
check(JSON.stringify(await items(maya.page)) === JSON.stringify(['Invite players', 'Leave lobby']), 'which a player who isn\'t the host doesn\'t get', JSON.stringify(await items(maya.page)));
await maya.page.mouse.click(60, 600);
await menuGone(maya.page);

// --- End game: asked first, then the results ---
await openMenu(hank.page);
await hank.page.locator('[data-testid="end-game-btn"]').click();
await hank.page.waitForSelector('ion-alert.end-alert button');
await hank.page.waitForTimeout(400);
check(/End the game\?/.test(await hank.page.locator('ion-alert.end-alert').innerText()), 'End game asks first');
await hank.page.locator('ion-alert.end-alert button', { hasText: 'Keep playing' }).click();
await hank.page.waitForTimeout(500);
check(await hank.page.locator('[data-phase="playing"]').count() === 1, 'Keep playing keeps playing');
await openMenu(hank.page);
await hank.page.locator('[data-testid="end-game-btn"]').click();
await hank.page.waitForSelector('ion-alert.end-alert button');
await hank.page.waitForTimeout(400);
await hank.page.locator('ion-alert.end-alert button', { hasText: 'End game' }).click();
check(await waitFor(hank.page, () => !!document.querySelector('[data-phase="ended"]')), 'End game ends it');
await hank.page.waitForTimeout(600);
await openMenu(hank.page);
check(await hank.page.locator('[data-testid="end-game-btn"]').count() === 0, 'and with no game on, End game is gone from the menu again');

// --- Leave lobby: asked first, then home ---
await openMenu(maya.page);
await maya.page.locator('[data-testid="leave-btn"]').click();
await maya.page.waitForSelector('ion-alert.leave-alert button');
await maya.page.waitForTimeout(400);
check(/Leave lobby\?/.test(await maya.page.locator('ion-alert.leave-alert').innerText()), 'Leave lobby asks first');
await maya.page.locator('ion-alert.leave-alert button', { hasText: 'Cancel' }).click();
await maya.page.waitForTimeout(500);
check(await maya.page.locator('[data-testid="lobby-page"]').count() === 1, 'Cancel stays in the lobby');
await openMenu(maya.page);
await maya.page.locator('[data-testid="leave-btn"]').click();
await maya.page.waitForSelector('ion-alert.leave-alert button');
await maya.page.waitForTimeout(400);
await maya.page.locator('ion-alert.leave-alert button', { hasText: /^Leave$/ }).click();
check(await waitFor(maya.page, (home) => window.location.href === home, `${BASE}/`), 'Leave goes back to the first page', maya.page.url());
check(await waitFor(hank.page, () => !/Maya/.test(document.body.innerText)), 'and the player is gone from the lobby');

await Promise.all([hank, maya].map((p) => p.ctx.close()));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
