// Text positioning audit on the real screens. For every visible text:
//  - single-line text in a control (button, segment, input, tag, avatar,
//    toolbar) must be vertically centred in it (±1.5px), and horizontally too
//    when the control centres its text
//  - no two texts may overlap
//  - text inside a card or row needs ≥ 8px from that card's edge
//  - a row's parts (label block, distance, menu, chevron) share a centre line
import { BASE, makePlayer, createLobby, join, startGame } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
const findings = [];

async function audit(page, label) {
  const found = await page.evaluate(() => {
    const out = [];
    const vis = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0 && r.width > 0 && r.height > 0;
    };
    const name = (el) => `${el.tagName.toLowerCase()}${el.dataset?.testid ? `[${el.dataset.testid}]` : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`;
    // Glyph box of an element's text: union of its text nodes' line boxes,
    // trimmed to the font's ascent/descent (cap-height-ish centring uses line box)
    const textBox = (el) => {
      const range = document.createRange();
      let box = null;
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) {
        if (!t.textContent.trim()) continue;
        range.selectNodeContents(t);
        for (const r of range.getClientRects()) {
          if (r.width === 0) continue;
          box = box ? { left: Math.min(box.left, r.left), right: Math.max(box.right, r.right), top: Math.min(box.top, r.top), bottom: Math.max(box.bottom, r.bottom), lines: box.lines + 1 }
            : { left: r.left, right: r.right, top: r.top, bottom: r.bottom, lines: 1 };
        }
      }
      return box;
    };
    const root = [...document.querySelectorAll('ion-modal.show-modal, ion-action-sheet:not(.overlay-hidden), .ion-page:not(.ion-page-hidden)')].pop() || document.body;

    // 1. Centring in controls
    const controls = [
      ['ion-button', (b) => b.shadowRoot?.querySelector('.button-native'), true],
      ['ion-segment-button', (b) => b, true],
      ['.avatar', (a) => a, true],
      ['.avatar-edit-label, .avatar-badge', (a) => a, true],
      ['ion-title', (t) => t.closest('ion-toolbar').shadowRoot?.querySelector('.toolbar-container') || t, false],
      ['.connection-banner, .offline-banner', (b) => b, true],
      ['.action-sheet-button', (b) => b, true]
    ];
    for (const [sel, boxOf, horizontal] of controls) {
      for (const el of root.querySelectorAll(sel)) {
        if (!vis(el) || el.closest('[aria-hidden="true"]')) continue;
        const tb = textBox(el);
        const host = boxOf(el);
        if (!tb || !host || tb.lines > 1) continue;
        const cb = host.getBoundingClientRect();
        const dy = (tb.top - cb.top) - (cb.bottom - tb.bottom);
        if (Math.abs(dy) > 3) out.push(`${name(el)} "${el.textContent.trim().slice(0, 20)}" text is ${(dy / 2).toFixed(1)}px off vertical centre`);
        if (horizontal && getComputedStyle(el).textAlign !== 'start') {
          const dx = (tb.left - cb.left) - (cb.right - tb.right);
          const iconOnly = !el.textContent.trim();
          if (!iconOnly && Math.abs(dx) > 3 && cb.width - (tb.right - tb.left) > 8) out.push(`${name(el)} "${el.textContent.trim().slice(0, 20)}" text is ${(dx / 2).toFixed(1)}px off horizontal centre`);
        }
      }
    }
    // Toolbar: title and its buttons share a centre line
    for (const tb of root.querySelectorAll('ion-toolbar')) {
      if (!vis(tb)) continue;
      const title = tb.querySelector('ion-title');
      const tbox = title && textBox(title);
      if (!tbox) continue;
      const tMid = (tbox.top + tbox.bottom) / 2;
      for (const b of tb.querySelectorAll('ion-buttons ion-button')) {
        if (!vis(b)) continue;
        const bt = textBox(b) || b.getBoundingClientRect();
        const bMid = (bt.top + bt.bottom) / 2;
        if (Math.abs(bMid - tMid) > 1.5) out.push(`toolbar "${title.textContent.trim().slice(0, 16)}": button "${b.textContent.trim() || b.getAttribute('aria-label')}" centre ${(bMid - tMid).toFixed(1)}px from the title's`);
      }
    }

    // 2. Overlapping texts
    const texts = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const el = t.parentElement;
      if (!t.textContent.trim() || !el || !vis(el) || el.closest('svg, .leaflet-control-attribution, [aria-hidden="true"]')) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) if (r.width > 0) texts.push({ el, r, s: t.textContent.trim().slice(0, 18) });
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i].r, b = texts[j].r;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 2 && texts[i].el !== texts[j].el) out.push(`"${texts[i].s}" overlaps "${texts[j].s}" (${ox.toFixed(0)}×${oy.toFixed(0)}px)`);
    }

    // 3. Text too close to its card / row edge
    for (const { el, r, s } of texts) {
      const box = el.closest('ion-card, ion-item, .card, .profile-card, .status-card, .settings-row, ion-list[inset="true"], .permission-list');
      if (!box) continue;
      const b = box.getBoundingClientRect();
      const gaps = [r.left - b.left, b.right - r.right];
      if (Math.min(...gaps) < 8) out.push(`"${s}" is ${Math.min(...gaps).toFixed(1)}px from the edge of ${name(box)}`);
    }

    // 4. Row parts on one centre line
    for (const item of root.querySelectorAll('ion-item')) {
      if (!vis(item)) continue;
      const parts = [...item.querySelectorAll(':scope > [slot="end"], :scope > ion-label, :scope > .target-distance, :scope > ion-button, :scope > ion-icon[slot="end"]')].filter(vis);
      if (parts.length < 2) continue;
      const mids = parts.map((p) => { const r = p.getBoundingClientRect(); return { p, m: (r.top + r.bottom) / 2 }; });
      const base = mids.find((x) => x.p.tagName === 'ION-LABEL') || mids[0];
      for (const x of mids) if (Math.abs(x.m - base.m) > 1.5) out.push(`row "${item.textContent.trim().slice(0, 16)}": ${name(x.p)} centre ${(x.m - base.m).toFixed(1)}px from the label's`);
    }
    return [...new Set(out)];
  });
  findings.push(...found.map((f) => `${label}: ${f}`));
}

const ctxHome = await makePlayer(browser, { latitude: 39.19, longitude: -96.58 });
const home = await ctxHome.newPage();
await home.goto(BASE);
await home.waitForTimeout(800);
await audit(home, 'home');

const id = await createLobby('Saturday park game');
const host = await join(browser, id, { latitude: 39.19, longitude: -96.58 }, { name: 'Hank', host: true });
const guest = await join(browser, id, { latitude: 39.1915, longitude: -96.5795 }, { name: 'Maya' });
await host.page.locator('[data-testid="role-seeker"]').click();
await host.page.waitForTimeout(1200);
await audit(host.page, 'lobby');

// The installed app's first-open popup, and the Settings page
const freshCtx = await makePlayer(browser, { latitude: 39.19, longitude: -96.58 });
await freshCtx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
const fresh = await freshCtx.newPage();
await fresh.goto(BASE);
await fresh.waitForSelector('[data-testid="setup-done"]');
await fresh.waitForTimeout(600);
await audit(fresh, 'permissions');
await fresh.locator('[data-testid="setup-done"]').click();
await fresh.goto(`${BASE}/settings`);
await fresh.waitForSelector('[data-testid="settings-page"]');
await fresh.waitForTimeout(500);
await audit(fresh, 'settings page');

await host.page.locator('[data-testid="settings-row"]').click();
await host.page.waitForTimeout(900);
await audit(host.page, 'settings');
await host.page.locator('ion-modal.show-modal [data-testid="settings-cancel"]').click();
await host.page.waitForTimeout(700);

// Invite is in the toolbar's menu
await host.page.locator('[data-testid="menu-btn"]').click().catch(() => {});
await host.page.waitForTimeout(500);
await audit(host.page, 'menu');
await host.page.locator('[data-testid="invite-btn"]').click().catch(() => {});
await host.page.waitForTimeout(900);
await audit(host.page, 'invite');
await host.page.locator('ion-modal.show-modal ion-button:has-text("Close")').click().catch(() => {});
await host.page.waitForTimeout(700);

await host.page.locator('[data-testid="player-menu"], .row-menu-btn').first().click().catch(() => {});
await host.page.waitForTimeout(700);
await audit(host.page, 'player menu');
await host.page.locator('ion-action-sheet:not(.overlay-hidden) button:has-text("Cancel")').click().catch(() => {});
await host.page.waitForTimeout(600);

await startGame(host.page, guest.page);
await host.page.waitForTimeout(1500);
await audit(host.page, 'seeker');
await audit(guest.page, 'hider');
await host.page.locator('[data-testid="target-card"]').first().click();
await host.page.waitForTimeout(800);
await audit(host.page, 'compass');

console.log(findings.length ? findings.join('\n') : 'TEXT POSITION: nothing off');
await browser.close();
