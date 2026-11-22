// The lobby's chat: one conversation for everyone, with an unread count on its button
import { SHOT, createLobby, join, startGame, passGate, detailedPhoto, fakePhoto } from '../lib/helpers.mjs';
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
  name: li.querySelector('.chat-name').innerText, text: li.querySelector('.chat-text')?.innerText ?? '',
  picture: !!li.querySelector('[data-testid="chat-image"]'),
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

// --- A picture: compressed on the phone, shown to everyone, opened full screen ---
await passGate(hank.page); // asked again after his reload, and it sits over the chat
const photo = await detailedPhoto(browser);
const sendDisabled = (page) => page.locator(modal('[data-testid="chat-send"]')).evaluate((b) => b.classList.contains('button-disabled') || b.hasAttribute('disabled'));
const attached = (page) => waitFor(page, () => !!document.querySelector('ion-modal.show-modal [data-testid="chat-attachment"]'));
check(await maya.page.locator(modal('[data-testid="chat-attach"]')).count() === 1, 'there is a button to add a picture');
await maya.page.locator(modal('[data-testid="chat-file"]')).setInputFiles(photo);
check(await attached(maya.page), 'a chosen picture waits above the box');
const note = await text(maya.page, modal('.chat-attachment-note'));
check(/^Picture · \d+ KB$/.test(note) && Number(/(\d+) KB/.exec(note)[1]) <= 60, 'at 60 KB or less', `${note} (the file was ${Math.round(photo.buffer.length / 1000)} KB)`);
check(!(await sendDisabled(maya.page)), 'and can be sent without any words');
await maya.page.screenshot({ path: `${SHOT}/chat-picture-attached.png` });
await maya.page.locator(modal('[data-testid="chat-send"]')).click();
check(await hasMessages(maya.page, 5), 'it is sent as a message');
check(await maya.page.locator(modal('[data-testid="chat-attachment"]')).count() === 0, 'and the box is clear again');
const loaded = (page) => waitFor(page, () => {
  const img = [...document.querySelectorAll('ion-modal.show-modal [data-testid="chat-image"] img')].at(-1);
  return !!img && img.complete && img.naturalWidth > 0;
});
check(await loaded(maya.page), 'the sender sees the picture in the conversation');
const sent = await maya.page.evaluate(async () => {
  const img = document.querySelector('ion-modal.show-modal [data-testid="chat-image"] img');
  const blob = await (await fetch(img.src)).blob();
  return { type: blob.type, bytes: blob.size, width: img.naturalWidth, height: img.naturalHeight, shown: Math.round(img.getBoundingClientRect().width) };
});
check(sent.type === 'image/webp' && sent.bytes <= 60000, 'what was sent is a WebP of 60 KB or less', JSON.stringify(sent));
check(Math.max(sent.width, sent.height) <= 1280 && sent.width > sent.height && sent.width >= 320, 'no bigger than 1280 pixels, in its own shape', JSON.stringify(sent));
check(sent.shown <= 240, 'shown small in the message', String(sent.shown));
// A message with only a picture is as narrow as its header can be: the name
// and side at the left, the time at the right, three spaces between them
const widths = (page) => page.evaluate(() => [...document.querySelectorAll('ion-modal.show-modal [data-testid="chat-message"]')].map((li) => {
  const time = li.querySelector('.chat-time');
  const left = li.querySelector('.chat-role') || li.querySelector('.chat-name');
  const digits = document.createRange();
  digits.selectNodeContents(time);
  const pen = document.createElement('canvas').getContext('2d');
  const style = getComputedStyle(time);
  pen.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const image = li.querySelector('.chat-image');
  const inner = li.clientWidth - parseFloat(getComputedStyle(li).paddingLeft) - parseFloat(getComputedStyle(li).paddingRight);
  return { bubble: li.getBoundingClientRect().width, inner, gap: digits.getBoundingClientRect().left - left.getBoundingClientRect().right,
    threeSpaces: pen.measureText('   ').width, image: image ? image.getBoundingClientRect().width : null };
}));
const alone = (await widths(maya.page)).at(-1);
check(Math.abs(alone.gap - alone.threeSpaces) < 1, 'a picture on its own makes the narrowest message: three spaces between the header\'s two ends', JSON.stringify(alone));
check(Math.abs(alone.image - alone.inner) < 1, 'with the picture filling it', JSON.stringify(alone));
check(await loaded(hank.page), 'the other player gets the picture');
// Its room is kept from the numbers in the message, so the chat is already at its end when it loads
const short = await hank.page.evaluate(async () => {
  const el = await document.querySelector('ion-modal.show-modal ion-content.chat-content').getScrollElement();
  return Math.round(el.scrollHeight - el.clientHeight - el.scrollTop);
});
check(short <= 16, 'and the conversation is scrolled to it, not left short by its height', String(short));
const last = (await messages(hank.page)).at(-1);
check(last.name === 'Maya' && last.picture && last.text === '', 'as a message from its sender, with no words', JSON.stringify(last));
await hank.page.waitForTimeout(400);
await hank.page.screenshot({ path: `${SHOT}/chat-picture.png` });

// Tap it: the whole picture, as large as the screen allows
await hank.page.locator(modal('[data-testid="chat-image"]')).last().click();
await hank.page.waitForSelector('ion-modal.chat-viewer.show-modal [data-testid="chat-viewer-image"]');
await hank.page.waitForTimeout(500);
const viewer = await hank.page.evaluate(() => {
  const img = document.querySelector('[data-testid="chat-viewer-image"]');
  const r = img.getBoundingClientRect();
  return { width: Math.round(r.width), height: Math.round(r.height), view: [window.innerWidth, window.innerHeight], fit: getComputedStyle(img).objectFit, loaded: img.naturalWidth > 0 };
});
check(viewer.loaded && viewer.width >= viewer.view[0] - 2 && viewer.height >= viewer.view[1] - 2 && viewer.fit === 'contain', 'tapping a picture opens it full screen, all of it showing', JSON.stringify(viewer));
await hank.page.screenshot({ path: `${SHOT}/chat-picture-full.png` });
await hank.page.locator('[data-testid="chat-viewer-close"]').click();
check(await waitFor(hank.page, () => !document.querySelector('ion-modal.chat-viewer.show-modal')), 'Close goes back');
await hank.page.locator(modal('[data-testid="chat-image"]')).last().click();
await hank.page.waitForSelector('ion-modal.chat-viewer.show-modal [data-testid="chat-viewer-image"]');
await hank.page.waitForTimeout(500);
await hank.page.locator('[data-testid="chat-viewer-image"]').click();
check(await waitFor(hank.page, () => !document.querySelector('ion-modal.chat-viewer.show-modal')), 'and so does tapping the picture');
check(await hank.page.locator(modal('[data-testid="chat-input"]')).count() === 1, 'to the conversation, still open');

// With words, after changing one's mind once
await hank.page.locator(modal('[data-testid="chat-file"]')).setInputFiles(await fakePhoto(browser));
check(await attached(hank.page), 'a second picture is chosen');
await hank.page.locator(modal('[data-testid="chat-attachment-remove"]')).click();
check(await waitFor(hank.page, () => !document.querySelector('ion-modal.show-modal [data-testid="chat-attachment"]')
  && document.querySelector('ion-modal.show-modal [data-testid="chat-send"]').classList.contains('button-disabled')), 'it can be taken off again, leaving nothing to send');
await hank.page.locator(modal('[data-testid="chat-file"]')).setInputFiles(await fakePhoto(browser, 200));
await attached(hank.page);
await say(hank.page, 'Is this you?');
check(await hasMessages(hank.page, 6), 'a picture can go with words');
const captioned = (await messages(hank.page)).at(-1);
check(captioned.picture && captioned.text === 'Is this you?' && captioned.mine, 'both in one message', JSON.stringify(captioned));
const sizes = await widths(hank.page);
check(sizes.at(-1).image > sizes.at(-2).image + 20 && sizes.at(-1).gap > sizes.at(-1).threeSpaces + 20, 'a picture with words keeps its larger size', JSON.stringify(sizes.slice(-2)));
check(sizes.every((m) => m.gap >= m.threeSpaces - 1), 'and no message\'s header is squeezed closer than three spaces', JSON.stringify(sizes.map((m) => Math.round(m.gap))));

// What isn't a picture
await hank.page.locator(modal('[data-testid="chat-file"]')).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') });
check(await waitFor(hank.page, () => [...document.querySelectorAll('ion-toast')].some((t) => /picture/i.test(t.message))), 'a file that is not a picture is refused, with a reason');
check(await hank.page.locator(modal('[data-testid="chat-attachment"]')).count() === 0, 'and nothing is attached');

// Someone who opens the chat later gets the pictures too
await openChat(priya.page);
check(await loaded(priya.page) && (await messages(priya.page)).filter((m) => m.picture).length === 2, 'someone who joined late sees the pictures as well');
await closeChat(priya.page);
await maya.page.waitForTimeout(5200); // past the limit on how fast one player can write

// --- Sending too fast ---
for (let i = 0; i < 6; i++) { await say(maya.page, `quick ${i}`); await maya.page.waitForTimeout(120); }
check(await waitFor(maya.page, () => [...document.querySelectorAll('ion-toast')].some((t) => /too quickly/.test(t.message))), 'a burst of messages is told to slow down');

await Promise.all([hank, maya, priya].map((p) => p.ctx.close()));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
