// iPhone: leaving a text field clears the page's undo history (an empty frame
// opens and closes; in Safari that empties the list a shake would undo).
// Here: that it happens, and that nothing else changes
import { BASE, makePlayer, passGate } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';
const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FIELD = '[data-testid="create-name-input"] input';
const watchFrames = () => {
  window.__frames = { added: 0, removed: 0 };
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) if (n.tagName === 'IFRAME') window.__frames.added++;
      for (const n of r.removedNodes) if (n.tagName === 'IFRAME') window.__frames.removed++;
    }
  }).observe(document, { childList: true, subtree: true });
};

async function phone(userAgent) {
  const ctx = await makePlayer(browser, { latitude: 39.19, longitude: -96.58 }, userAgent ? { userAgent } : {});
  await ctx.addInitScript(() => { localStorage.setItem('manhunt.installOffered', '1'); });
  await ctx.addInitScript(watchFrames);
  return { ctx, page: await ctx.newPage() };
}
const frames = (page) => page.evaluate(() => window.__frames);

// iPhone, landing page
const { ctx, page } = await phone(IPHONE);
await page.goto(BASE);
await page.locator(FIELD).click();
await page.keyboard.type('Riverside');
const whileTyping = await frames(page);
check(whileTyping.added === 0, 'nothing happens while typing');
await page.locator('h1').click(); // leave the field
await page.waitForTimeout(200);
const left = await frames(page);
check(left.added === 1 && left.removed === 1, 'leaving the field opens and closes one empty frame', JSON.stringify(left));
check(await page.locator('iframe').count() === 0, 'and leaves nothing behind');
check(await page.locator(FIELD).inputValue() === 'Riverside', 'the field still shows what was typed');
await page.locator('[data-testid="create-btn"]').click();
await page.waitForSelector('[data-testid="lobby-title"]', { timeout: 8000 });
check(await page.locator('[data-testid="lobby-title"]').innerText() === 'Riverside', 'and the app used it (the lobby is named Riverside)');

// iPhone, the name field: Save is what leaves it
await passGate(page);
const input = page.locator('[data-testid="name-input"] input');
await input.click();
await input.fill('');
await page.keyboard.type('Maya');
await page.locator('[data-testid="name-save"]').click();
await page.waitForTimeout(600);
check(/Maya/.test(await page.locator('[data-testid="lobby-players-list"]').innerText()), 'renaming still saves');
const afterSave = await frames(page);
check(afterSave.added === afterSave.removed && afterSave.added >= 2, 'and the history is cleared on the way out', JSON.stringify(afterSave));
// Undo still works while typing
await input.click();
await page.keyboard.type('!');
const undone = await page.evaluate(() => { document.execCommand('undo'); return document.querySelector('[data-testid="name-input"] input').value; });
check(undone === 'Maya', 'while typing, undo still works', undone);
await ctx.close();

// Not on other phones: Android and computers have no shake to undo
const other = await phone(null);
await other.page.goto(BASE);
await other.page.locator(FIELD).click();
await other.page.keyboard.type('Park');
await other.page.locator('h1').click();
await other.page.waitForTimeout(200);
check((await frames(other.page)).added === 0, 'other devices are left alone');
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
