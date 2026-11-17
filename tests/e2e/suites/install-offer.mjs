// The first-visit offer to add Manhunt to the Home Screen
import { BASE, SHOT, makePlayer, createLobby } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const POS = { latitude: 39.19, longitude: -96.58 };
const alertSel = 'ion-alert.install-alert';
const offer = (page) => page.waitForSelector(alertSel, { state: 'visible', timeout: 5000 }).then(() => true, () => false);
const message = (page) => page.locator(`${alertSel} .alert-message`).innerText().catch(() => '');
const buttons = (page) => page.locator(`${alertSel} button`).allInnerTexts();
const id = await createLobby('Install');

// --- iPhone Safari, first visit through an invite link ---
{
  const ctx = await makePlayer(browser, POS, { userAgent: IPHONE });
  await ctx.addInitScript(() => { delete window.PushManager; });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/lobby/${id}`);
  check(await offer(page), 'iPhone: offered on the first visit');
  check(/Share button, then Add to Home Screen/.test(await message(page)), 'with the Share → Add to Home Screen steps', await message(page));
  check(JSON.stringify(await buttons(page)) === '["Got it"]', 'one button', JSON.stringify(await buttons(page)));
  await page.screenshot({ path: `${SHOT}/install-ios.png` });
  await page.locator(`${alertSel} button:has-text("Got it")`).click();
  check(await page.waitForSelector(alertSel, { state: 'hidden', timeout: 3000 }).then(() => true, () => false)
    && await page.locator('[data-testid="lobby-page"]').isVisible(), 'Got it closes it, into the lobby');
  await page.reload();
  check(!(await offer(page)), 'not offered again on the next visit');
  await page.goto(BASE);
  check(!(await offer(page)), 'nor on the landing page');
  await ctx.close();
}

// --- Android, a browser without an install prompt ---
{
  const ctx = await makePlayer(browser, POS, { userAgent: ANDROID });
  const page = await ctx.newPage();
  await page.goto(BASE);
  check(await offer(page), 'Android: offered on the landing page too');
  check(/browser’s menu and choose Add to Home screen/.test(await message(page)), 'with the menu steps', await message(page));
  await page.screenshot({ path: `${SHOT}/install-android-menu.png` });
  await ctx.close();
}

// --- Chrome with its own install prompt ---
{
  const ctx = await makePlayer(browser, POS, { userAgent: ANDROID });
  await ctx.addInitScript(() => {
    setTimeout(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = async () => { window.__prompted = true; };
      window.dispatchEvent(event);
    }, 300);
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  check(await offer(page), 'Chrome: offered');
  check(JSON.stringify(await buttons(page)) === '["Not now","Install"]', 'with an Install button', JSON.stringify(await buttons(page)));
  check(!/menu|Share/.test(await message(page)), 'and no manual steps', await message(page));
  await page.screenshot({ path: `${SHOT}/install-chrome.png` });
  await page.locator(`${alertSel} button:has-text("Install")`).click();
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__prompted === true), "Install opens the browser's own install prompt");
  check(!(await page.locator(alertSel).isVisible().catch(() => false)), 'and the offer closes');
  await ctx.close();
}

// --- Already installed: never offered ---
{
  const ctx = await makePlayer(browser, POS, { userAgent: IPHONE });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/lobby/${id}`);
  check(!(await offer(page)), 'the Home Screen app is never offered');
  check(await page.waitForSelector('[data-testid="lobby-page"]', { timeout: 8000 }).then(() => true, () => false), 'and goes straight into the lobby');
  await ctx.close();
}

// --- Desktop browser that can't install: not offered ---
{
  const ctx = await makePlayer(browser, POS);
  const page = await ctx.newPage();
  await page.goto(BASE);
  check(!(await offer(page)), "a desktop browser that can't install isn't offered");
  await ctx.close();
}

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
