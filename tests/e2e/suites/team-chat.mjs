// Each side's own chat: the hiders' and the seekers', beside everyone's
import { SHOT, createLobby, join, startGame, passGate } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
const waitFor = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const modal = (sel) => `ion-modal.show-modal ${sel}`;
const openChat = async (page) => {
  await page.locator('[data-testid="chat-btn"]').click();
  await page.waitForSelector(modal('[data-testid="chat-input"]'));
  await page.waitForTimeout(450);
};
const closeChat = async (page) => {
  await page.locator(modal('[data-testid="chat-close"]')).click();
  await page.waitForSelector('ion-modal.show-modal', { state: 'detached', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
};
const tab = async (page, which) => {
  await page.locator(modal(`[data-testid="chat-tab-${which}"]`)).click();
  await page.waitForTimeout(350);
};
const say = async (page, message) => {
  await page.locator(modal('[data-testid="chat-input"] input')).fill(message);
  await page.locator(modal('[data-testid="chat-send"]')).click();
};
const shown = (page) => page.locator(modal('[data-testid="chat-message"] .chat-text')).allInnerTexts();
const shows = (page, list) => waitFor(page, (want) => JSON.stringify([...document.querySelectorAll('ion-modal.show-modal [data-testid="chat-message"] .chat-text')].map((p) => p.innerText)) === JSON.stringify(want), list);
const badge = (page) => text(page, '[data-testid="chat-unread"]');
// Everything a phone is ever sent of the chat, whichever tab is showing
const tap = (page) => page.evaluate(() => {
  window.__heard = [];
  window.__manhuntSocket.on('chat-message', (m) => window.__heard.push(m.text));
  window.__manhuntSocket.on('chat-history', (h) => window.__heard.push(...h.messages.map((m) => m.text)));
});
const heard = (page) => page.evaluate(() => window.__heard);

const HANK = { latitude: 39.19, longitude: -96.58 };       // seeker, host
const SAM = { latitude: 39.1895, longitude: -96.5812 };    // seeker
const MAYA = { latitude: 39.1903, longitude: -96.58 };     // hider, ~33 m from Hank
const PRIYA = { latitude: 39.1921, longitude: -96.5808 };  // hider

const id = await createLobby('Sides');
const hank = await join(browser, id, HANK, { name: 'Hank', host: true, seeker: true });
const sam = await join(browser, id, SAM, { name: 'Sam', seeker: true });
const maya = await join(browser, id, MAYA, { name: 'Maya' });
const priya = await join(browser, id, PRIYA, { name: 'Priya' });
for (const p of [hank, sam, maya, priya]) await tap(p.page);
await startGame(hank.page, sam.page, maya.page, priya.page);

// --- The switch: everyone, and your own side ---
await openChat(maya.page);
check(await text(maya.page, modal('[data-testid="chat-tab-all"]')) === 'Everyone' && await text(maya.page, modal('[data-testid="chat-tab-side"]')) === 'Hiders', 'a hider\'s chat has Everyone and Hiders');
await openChat(hank.page);
check(await text(hank.page, modal('[data-testid="chat-tab-side"]')) === 'Seekers', 'a seeker\'s has Everyone and Seekers', await text(hank.page, modal('[data-testid="chat-tab-side"]')));
check(await maya.page.locator(modal('[data-testid="chat-tab-all"]')).evaluate((b) => b.classList.contains('segment-button-checked')), 'it opens on Everyone');

// --- The hiders' chat ---
await tab(maya.page, 'side');
check(/Only the hiders see/.test(await text(maya.page, modal('[data-testid="chat-empty"]'))), 'an empty side chat says who sees it', await text(maya.page, modal('[data-testid="chat-empty"]')));
check(await maya.page.locator(modal('[data-testid="chat-input"] input')).getAttribute('placeholder') === 'Message the hiders', 'and the box says who it writes to');
await say(maya.page, 'I am behind the library');
check(await shows(maya.page, ['I am behind the library']), 'a hider writes to the hiders');
check(await waitFor(priya.page, () => document.querySelector('[data-testid="chat-unread"]')?.innerText === '1'), 'the other hider\'s chat button counts it', await badge(priya.page));
await openChat(priya.page);
check(await shows(priya.page, []), 'which isn\'t in Everyone');
check(await text(priya.page, modal('[data-testid="chat-tab-unread"]')) === '1' && /Hiders/.test(await text(priya.page, modal('[data-testid="chat-tab-side"]'))), 'the Hiders tab carries the count', await text(priya.page, modal('[data-testid="chat-tabs"]')));
await priya.page.screenshot({ path: `${SHOT}/team-chat-count.png` });
await tab(priya.page, 'side');
check(await shows(priya.page, ['I am behind the library']), 'and has the message');
check(await priya.page.locator(modal('[data-testid="chat-tab-unread"]')).count() === 0, 'reading it clears the count');
check(await priya.page.locator(modal('.chat-role')).count() === 0, 'a side\'s chat doesn\'t label each message with the side');
await priya.page.screenshot({ path: `${SHOT}/team-chat-hiders.png` });

// --- The seekers never get it ---
await say(hank.page, 'Anyone seen them?');
check(await shows(hank.page, ['Anyone seen them?']) && await shows(maya.page, ['I am behind the library']), 'what\'s said to everyone stays out of the hiders\' chat');
await tab(hank.page, 'side');
check(await shows(hank.page, []), 'the seekers\' chat is empty: nothing of the hiders\' is in it');
await say(hank.page, 'Sam, take the north side');
check(await shows(hank.page, ['Sam, take the north side']), 'a seeker writes to the seekers');
await openChat(sam.page);
await tab(sam.page, 'side');
check(await shows(sam.page, ['Sam, take the north side']), 'the other seeker gets it');
await sam.page.waitForTimeout(600);
const seekersHeard = [...await heard(hank.page), ...await heard(sam.page)];
const hidersHeard = [...await heard(maya.page), ...await heard(priya.page)];
check(!seekersHeard.some((m) => /library/.test(m)), 'no seeker\'s phone was ever sent the hiders\' message', JSON.stringify(seekersHeard));
check(!hidersHeard.some((m) => /north side/.test(m)), 'and no hider\'s the seekers\'', JSON.stringify(hidersHeard));
check(hidersHeard.filter((m) => m === 'Anyone seen them?').length === 2, 'while everyone got what was said to everyone');

// --- Read apart: Everyone can be unread while your side's is read ---
await say(sam.page, 'On it');
await tab(priya.page, 'all');
check(await shows(priya.page, ['Anyone seen them?']), 'back on Everyone: just everyone\'s');
await closeChat(priya.page);
await say(maya.page, 'Stay low');
check(await waitFor(priya.page, () => document.querySelector('[data-testid="chat-unread"]')?.innerText === '1'), 'with the chat closed, a side message counts on the button', await badge(priya.page));
await priya.page.reload();
await passGate(priya.page);
await tap(priya.page);
check(await waitFor(priya.page, () => document.querySelector('[data-testid="chat-unread"]')?.innerText === '1'), 'after a reload the side\'s chat is still there, and still counted', await badge(priya.page));
await openChat(priya.page);
await tab(priya.page, 'side');
check(await shows(priya.page, ['I am behind the library', 'Stay low']), 'all of it');
await closeChat(priya.page);

// --- A hider who is caught: out of the hiders' chat, into the seekers' from now ---
await maya.page.locator(modal('[data-testid="chat-input"] input')).fill('they are right behi');
await closeChat(maya.page);
await maya.page.locator('[data-testid="found-btn"]').click();
await maya.page.waitForSelector('ion-alert.found-alert');
await maya.page.waitForTimeout(400);
await maya.page.locator('ion-alert.found-alert button:has-text("I’ve been found")').click();
check(await waitFor(maya.page, () => document.querySelector('[data-testid="game-role"]')?.innerText === 'Seeker'), 'Maya is found, and joins the seekers');
await maya.page.waitForTimeout(600);
await openChat(maya.page);
check(await maya.page.locator(modal('[data-testid="chat-tab-all"]')).evaluate((b) => b.classList.contains('segment-button-checked')), 'her chat is back on Everyone');
check(await maya.page.locator(modal('[data-testid="chat-input"] input')).inputValue() === '', 'what she was writing to the hiders is gone');
check(await text(maya.page, modal('[data-testid="chat-tab-side"]')) === 'Seekers', 'her side\'s chat is now the seekers\'');
await tab(maya.page, 'side');
check(await shows(maya.page, []), 'which starts empty for her: nothing the seekers said before', JSON.stringify(await shown(maya.page)));
await maya.page.screenshot({ path: `${SHOT}/team-chat-caught.png` });
await openChat(priya.page);
await tab(priya.page, 'side');
await say(priya.page, 'They got Maya');
check(await shows(priya.page, ['I am behind the library', 'Stay low', 'They got Maya']), 'the hiders\' chat goes on without her');
await say(hank.page, 'One left');
check(await shows(maya.page, ['One left']), 'and she gets what the seekers say from now on');
const mayaAfter = (await heard(maya.page)).slice((await heard(maya.page)).lastIndexOf('Stay low') + 1);
check(!mayaAfter.some((m) => /They got Maya|library|Stay low/.test(m)), 'her phone is sent nothing more of the hiders\'', JSON.stringify(mayaAfter));

await Promise.all([hank, sam, maya, priya].map((p) => p.ctx.close()));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
