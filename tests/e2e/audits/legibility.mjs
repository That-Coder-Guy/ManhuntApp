// Legibility audit on the real screens: every visible text node's rendered
// size (flag < 11px) and its contrast against the background actually behind
// it (flag < 4.5:1, or < 3:1 for large text: 24px+, or 18.66px+ bold).
import { BASE, makePlayer, createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
const results = [];

async function check(page, label) {
  const found = await page.evaluate(() => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const blend = (top, under) => ({
      r: top.r * top.a + under.r * (1 - top.a),
      g: top.g * top.a + under.g * (1 - top.a),
      b: top.b * top.a + under.b * (1 - top.a),
      a: 1
    });
    // Background behind an element: blend its ancestors' backgrounds,
    // including Ionic's shadow-DOM parts via the host's --background
    const background = (el) => {
      const layers = [];
      for (let n = el; n; n = n.parentElement || n.getRootNode()?.host) {
        const cs = getComputedStyle(n);
        let c = parse(cs.backgroundColor);
        if ((!c || c.a === 0) && n.tagName?.startsWith('ION-')) {
          const v = cs.getPropertyValue('--background').trim();
          if (v) {
            const probe = document.createElement('span');
            probe.style.color = v;
            document.body.appendChild(probe);
            c = parse(getComputedStyle(probe).color);
            probe.remove();
          }
        }
        if (c && c.a > 0) layers.push(c);
        if (c && c.a === 1) break;
      }
      let result = { r: 11, g: 13, b: 20, a: 1 }; // page ink
      for (let i = layers.length - 1; i >= 0; i--) result = blend(layers[i], result);
      return result;
    };
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue;
      const el = t.parentElement;
      if (!el || seen.has(el) || el.closest('.leaflet-tile-pane, ion-toast, [aria-hidden="true"]:not(svg)')) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      if (el.closest('.ion-page-hidden, ion-modal:not(.show-modal)')) continue;
      const size = parseFloat(cs.fontSize);
      const fg = parse(cs.fill && el.closest('svg') ? cs.fill : cs.color);
      if (!fg) continue;
      const bg = background(el);
      const color = fg.a < 1 ? blend(fg, bg) : fg;
      const [hi, lo] = [lum(color), lum(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const bold = +cs.fontWeight >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const disabled = !!el.closest('[disabled], .button-disabled, .item-disabled');
      const text = t.textContent.trim().slice(0, 28);
      if (size < 11) out.push(`${size}px text "${text}"`);
      if (!disabled && ratio < (large ? 3 : 4.5)) out.push(`contrast ${ratio.toFixed(2)}:1 at ${size}px for "${text}"`);
    }
    return out;
  });
  results.push(...found.map((f) => `${label}: ${f}`));
}

const id = await createLobby('Saturday park game');
const home = await (await makePlayer(browser, { latitude: 39.19, longitude: -96.58 })).newPage();
await home.goto(BASE);
await home.waitForTimeout(800);
await check(home, 'home');

const host = await join(browser, id, { latitude: 39.19, longitude: -96.58 }, { name: 'Hank', host: true, seeker: true });
const guest = await join(browser, id, { latitude: 39.1915, longitude: -96.5795 }, { name: 'Maya' });
await host.page.waitForTimeout(1200);
await check(host.page, 'lobby (host)');
await check(guest.page, 'lobby (guest)');

await host.page.locator('[data-testid="settings-row"]').click().catch(() => {});
await host.page.waitForTimeout(900);
await check(host.page, 'settings sheet');
await host.page.keyboard.press('Escape');
await host.page.locator('ion-modal.show-modal [data-testid="settings-cancel"], ion-modal.show-modal ion-button:has-text("Cancel")').first().click().catch(() => {});
await host.page.waitForTimeout(700);

await startGame(host.page, guest.page);
await host.page.waitForTimeout(1500);
await check(host.page, 'seeker list');
await check(guest.page, 'hider list');
await host.page.locator('[data-testid="target-card"]').first().click();
await host.page.waitForTimeout(800);
await check(host.page, 'compass');

console.log(results.length ? results.join('\n') : 'LEGIBILITY: every text meets size (≥11px) and WCAG AA contrast');
await browser.close();
