// The lobby's chat: one conversation for everyone, with an unread count on its button
import { SHOT, createLobby, join, startGame } from '../lib/helpers.mjs';
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
const say = async (page, message, how = 'button') => {
  await page.locator(modal('[data-testid="chat-input"] input')).fill(message);
  if (how === 'enter') await page.locator(modal('[data-testid="chat-input"] input')).press('Enter');
  else await page.locator(modal('[data-testid="chat-send"]')).click();
};
const messages = (page) => page.locator(modal('[data-testid="chat-message"]')).evaluateAll((items) => items.map((li) => ({
  name: li.querySelector('.chat-name').innerText, text: li.querySelector('.chat-text').innerText,
  role: li.querySelector('.chat-role')?.innerText ?? null, mine: li.classList.contains('chat-message--mine')
})));
const unread = (page) => text(page, '[data-testid="chat-unread"]');
const hasMessages = (page, count) => waitFor(page, (n) => document.querySelectorAll('ion-modal.show-modal [data-testid="chat-message"]').length === n, count);

const SEEKER = { latitude: 39.19, longitude: -96.58 };
const HIDER = { latitude: 39.1903, longitude: -96.58 };

const id = await createLobby('Chatty');
const hank = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
const maya = await join(browser, id, HIDER, { name: 'Maya' });

// --- An empty chat, and the first message ---
check(await hank.page.locator('[data-testid="chat-unread"]').count() === 0, 'no count on the chat button to begin with');
await openChat(hank.page);
check(/No messages yet/.test(await text(hank.page, modal('[data-testid="chat-empty"]'))), 'an empty chat says so', await text(hank.page, modal('[data-testid="chat-empty"]')));
check(await hank.page.locator(modal('[data-testid="chat-send"]')).evaluate((b) => b.classList.contains('button-disabled') || b.hasAttribute('disabled')), 'and Send waits for something to send');
await hank.page.screenshot({ path: `${SHOT}/chat-empty.png` });
await say(hank.page, 'Ready when you are');
check(await hasMessages(hank.page, 1), 'a sent message appears');
const own = (await messages(hank.page))[0];
check(own.name === 'You' && own.mine && own.text === 'Ready when you are', 'as your own', JSON.stringify(own));
check(await hank.page.locator(modal('[data-testid="chat-input"] input')).inputValue() === '', 'and the box clears');

// --- The other player: a count on the button, then the message ---
check(await waitFor(maya.page, () => document.querySelector('[data-testid="chat-unread"]')?.innerText === '1'), 'the other player\'s chat button counts 1', await unread(maya.page));
await maya.page.screenshot({ path: `${SHOT}/chat-unread.png` });
await openChat(maya.page);
const got = (await messages(maya.page))[0];
check(got.name === 'Hank' && !got.mine && got.text === 'Ready when you are', 'and opening it shows who said what', JSON.stringify(got));
await say(maya.page, 'Two minutes', 'enter');
check(await hasMessages(maya.page, 2), 'Enter sends too');
check(await hasMessages(hank.page, 2) && (await messages(hank.page))[1].name === 'Maya', 'an open chat gets the reply straight away');
check(await hank.page.locator('[data-testid="chat-unread"]').count() === 0, 'with nothing to count while it is open');
await closeChat(maya.page);
check(await maya.page.locator('[data-testid="chat-unread"]').count() === 0, 'read messages are no longer counted');

// --- What can't be sent ---
check(await hank.page.locator(modal('[data-testid="chat-input"] input')).getAttribute('maxlength') === '280', 'the box takes 280 characters');
await hank.page.locator(modal('[data-testid="chat-input"] input')).fill('   ');
check(await hank.page.locator(modal('[data-testid="chat-send"]')).evaluate((b) => b.classList.contains('button-disabled') || b.hasAttribute('disabled')), 'spaces alone can\'t be sent');
await say(hank.page, '<img src=x onerror="window.__xss = 1"> <b>bold</b>');
check(await hasMessages(hank.page, 3), 'markup is sent as it was typed');
check((await messages(hank.page))[2].text === '<img src=x onerror="window.__xss = 1"> <b>bold</b>'
  && await hank.page.evaluate(() => window.__xss === undefined && !document.querySelector('.chat-text img, .chat-text b')), 'and shown as text, never run');
await closeChat(hank.page);

// --- During a game: still one chat, with each side marked ---
await startGame(hank.page, maya.page);
check(await waitFor(maya.page, () => document.querySelector('[data-testid="chat-unread"]')?.innerText === '1'), 'the count carries into the game', await unread(maya.page));
await openChat(maya.page);
await say(maya.page, 'You won’t find me');
check(await hasMessages(maya.page, 4), 'a hider can write during the game');
const inGame = await messages(maya.page);
check(inGame[0].role === 'Seeker' && inGame[3].role === 'Hider', 'and each message says which side its sender is on', JSON.stringify(inGame.map((m) => m.role)));
await maya.page.waitForTimeout(400);
await maya.page.screenshot({ path: `${SHOT}/chat-game.png` });
check(await waitFor(hank.page, () => document.querySelector('[data-testid="chat-unread"]')?.innerText === '1'), 'the seeker\'s button counts it');
await hank.page.screenshot({ path: `${SHOT}/chat-seeker-unread.png` });

// --- A reload, and a late joiner: the conversation is still there ---
await hank.page.reload();
await hank.page.waitForSelector('[data-testid="chat-btn"]');
check(await waitFor(hank.page, () => document.querySelector('[data-testid="chat-unread"]')?.innerText === '1'), 'after a reload, only what was unread is counted', await unread(hank.page));
await openChat(hank.page);
check((await messages(hank.page)).length === 4, 'and the whole conversation is back', String((await messages(hank.page)).length));
// (no name: the game is on, and names are set in the lobby)
const priya = await join(browser, id, HIDER);
check(await waitFor(priya.page, () => document.querySelector('[data-testid="chat-unread"]')?.innerText === '4'), 'someone who joins late is given what was said', await unread(priya.page));

// --- Sending too fast ---
for (let i = 0; i < 6; i++) { await say(maya.page, `quick ${i}`); await maya.page.waitForTimeout(120); }
check(await waitFor(maya.page, () => [...document.querySelectorAll('ion-toast')].some((t) => /too quickly/.test(t.message))), 'a burst of messages is told to slow down');

await Promise.all([hank, maya, priya].map((p) => p.ctx.close()));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
