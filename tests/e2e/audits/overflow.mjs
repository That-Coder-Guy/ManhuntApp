// Clipping/overflow audit across phone sizes and every main state.
// Flags: horizontal page scroll; any element whose box escapes a clipping
// ancestor (overflow hidden/clip) unless it is ellipsized text; anything
// outside the viewport horizontally.
import { chromium } from '../lib/playwright.mjs';
import { BASE, makePlayer, createLobby, join, startGame, fakePhoto } from '../lib/helpers.mjs';

const SIZES = [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 }];
const findings = [];

async function audit(page, label) {
  const res = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 0.5) out.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`);
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const describe = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}${el.dataset?.testid ? `[${el.dataset.testid}]` : ''}`;
    // Only the topmost page / open modal
    const roots = [...document.querySelectorAll('ion-modal.show-modal, .ion-page:not(.ion-page-hidden)')];
    const root = roots.find(r => r.tagName === 'ION-MODAL') || roots[roots.length - 1] || document.body;
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
      if (!visible(el) || el.closest('svg') && el.tagName !== 'svg') continue;
      // Map tiles and overlays extend past the map window by design
      if (el.closest('.leaflet-pane')) continue;
      // The seeker's map is a turned square larger than its view, clipped on purpose
      if (el.closest('.track-map')) continue;
      const r = el.getBoundingClientRect();
      if (r.left < -0.5 || r.right > vw + 0.5) {
        // allow content inside a horizontally scrolling region
        out.push(`${describe(el)} outside viewport x: ${r.left.toFixed(1)}..${r.right.toFixed(1)}`);
      }
      const cs = getComputedStyle(el);
      const ellipsized = cs.textOverflow === 'ellipsis';
      // walk up to the nearest clipping ancestor
      let a = el.parentElement;
      while (a && a !== document.body) {
        const acs = getComputedStyle(a);
        const ox = acs.overflowX, oy = acs.overflowY;
        if (ox !== 'visible' || oy !== 'visible') {
          const ar = a.getBoundingClientRect();
          const hClip = ox === 'hidden' || ox === 'clip';
          const vClip = oy === 'hidden' || oy === 'clip';
          if (!ellipsized && hClip && (r.left < ar.left - 0.5 || r.right > ar.right + 0.5))
            out.push(`${describe(el)} clipped horizontally by ${describe(a)} (${r.left.toFixed(1)}..${r.right.toFixed(1)} vs ${ar.left.toFixed(1)}..${ar.right.toFixed(1)})`);
          if (vClip && (r.top < ar.top - 0.5 || r.bottom > ar.bottom + 0.5))
            out.push(`${describe(el)} clipped vertically by ${describe(a)} (${r.top.toFixed(1)}..${r.bottom.toFixed(1)} vs ${ar.top.toFixed(1)}..${ar.bottom.toFixed(1)})`);
          break;
        }
        a = a.parentElement;
      }
    }
    return [...new Set(out)];
  });
  for (const f of res) findings.push(`${label}: ${f}`);
}

const browser = await chromium.launch();
const base = { latitude: 39.19, longitude: -96.58 };
const off = (a, b) => ({ latitude: base.latitude + a, longitude: base.longitude + b });
const photo = await fakePhoto(browser, 30);

for (const vp of SIZES) {
  const tag = `${vp.width}x${vp.height}`;
  const hctx = await makePlayer(browser, base, { viewport: vp });
  const hp = await hctx.newPage();
  await hp.goto(BASE); await hp.waitForSelector('[data-testid="create-btn"]'); await hp.waitForTimeout(300);
  await audit(hp, `${tag} home`);

  const id = await createLobby('A deliberately long lobby name for clipping');
  await hp.goto(`${BASE}/lobby/${id}`);
  await hp.waitForSelector('[data-testid="gate-continue"]'); await hp.waitForTimeout(500);
  await audit(hp, `${tag} gate`);
  await hctx.close();
  // The installed app's first-open popup, then the Settings page
  const sctx = await makePlayer(browser, base, { viewport: vp });
  await sctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  const sp = await sctx.newPage();
  await sp.goto(BASE); await sp.waitForSelector('[data-testid="setup-done"]'); await sp.waitForTimeout(600);
  await audit(sp, `${tag} setup`);
  await sp.locator('[data-testid="setup-done"]').click();
  await sp.goto(`${BASE}/settings`); await sp.waitForSelector('[data-testid="settings-page"]'); await sp.waitForTimeout(500);
  await audit(sp, `${tag} settings page`);
  await sctx.close();

  const host = await join(browser, id, base, { name: 'Maximiliana Featherstonehaugh-Smythe', host: true, viewport: vp });
  await host.page.locator('[data-testid="avatar-input"]').setInputFiles(photo);
  const seeker = await join(browser, id, off(0.0004, 0), { name: 'Theodora Wolfeschlegelsteinhausen', seeker: true, viewport: vp });
  await join(browser, id, off(0.004, 0.002), { name: 'Sam', seeker: true });
  await join(browser, id, off(0.006, 0), { name: 'Far Away Hider' });
  await host.page.waitForTimeout(1200);
  await audit(host.page, `${tag} pregame-host`);
  await audit(seeker.page, `${tag} pregame-guest`);

  await host.page.locator('[data-testid="name-input"] input').fill('Someone with a much longer replacement name');
  await host.page.waitForSelector('[data-testid="name-save"]');
  await audit(host.page, `${tag} name-dirty`);
  await host.page.locator('[data-testid="name-input"] input').fill('Maximiliana Featherstonehaugh-Smythe');

  await host.page.locator('[data-testid="settings-row"]').click();
  await host.page.waitForSelector('[data-testid="fence-toggle"]'); await host.page.waitForTimeout(400);
  await host.page.locator('[data-testid="fence-toggle"]').click();
  await host.page.waitForSelector('[data-testid="play-area-map"] .leaflet-tile-loaded', { timeout: 8000 });
  await host.page.locator('[data-testid="play-area-map"] .leaflet-control-zoom-out').click();
  await host.page.waitForTimeout(400);
  {
    const b = await host.page.locator('[data-testid="play-area-map"]').boundingBox();
    const r = Math.min(b.width, b.height) * 0.38;
    for (const [dx, dy] of [[-r, -r], [r, -r], [r, r], [-r, r]]) {
      await host.page.mouse.click(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy);
      await host.page.waitForTimeout(120);
    }
  }
  await host.page.evaluate(() => {
    const el = document.querySelector('[data-testid="time-limit"]');
    el.value = 90; el.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 90 }, bubbles: true }));
  });
  await host.page.waitForTimeout(300);
  await audit(host.page, `${tag} settings`);
  await host.page.locator('[data-testid="settings-save"]').click();
  await host.page.waitForTimeout(700);
  await audit(host.page, `${tag} pregame-after-settings`);

  await host.page.locator('[data-testid="player-menu"]').first().click();
  await host.page.waitForSelector('ion-action-sheet.player-actions:not(.overlay-hidden)'); await host.page.waitForTimeout(400);
  await audit(host.page, `${tag} player-menu`);
  await host.page.locator('ion-action-sheet.player-actions button:has-text("Cancel")').click();
  await host.page.waitForTimeout(400);

  await startGame(host.page, seeker.page);
  await host.page.waitForTimeout(1500);
  await audit(host.page, `${tag} game-hider`);
  await seeker.page.waitForTimeout(500);
  await audit(seeker.page, `${tag} game-seeker`);

  await host.ctx.setGeolocation(off(0.007, 0));
  await host.page.waitForSelector('[data-testid="out-of-bounds"]', { timeout: 6000 }).catch(() => findings.push(`${tag}: out-of-bounds status never showed`));
  await audit(host.page, `${tag} game-out-of-bounds`);

  await seeker.page.locator('[data-testid="target-card"]').first().click();
  await seeker.page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 40, beta: 10, gamma: 0, absolute: true }));
  });
  await seeker.page.waitForTimeout(600);
  await audit(seeker.page, `${tag} compass`);
  await seeker.page.locator('[data-testid="track-map-btn"]').click();
  await seeker.page.waitForSelector('[data-testid="track-map"] .leaflet-tile-loaded', { timeout: 10000 }).catch(() => findings.push(`${tag}: track map never loaded`));
  await seeker.page.waitForTimeout(900);
  await audit(seeker.page, `${tag} track-map`);
  await seeker.page.locator('[data-testid="track-compass"]').click();
  await seeker.page.waitForTimeout(400);

  await seeker.ctx.setOffline(true);
  await seeker.page.evaluate(() => window.__manhuntSocket?.io?.engine?.close());
  await seeker.page.waitForSelector('[data-testid="offline-banner"]', { timeout: 8000 }).catch(() => findings.push(`${tag}: offline banner never showed`));
  await audit(seeker.page, `${tag} compass-offline`);
  await seeker.ctx.setOffline(false);
  await seeker.page.waitForSelector('[data-testid="offline-banner"]', { state: 'detached', timeout: 15000 }).catch(() => {});

  // Invite is in the toolbar's menu
  await host.page.locator('[data-testid="menu-btn"]').click();
  await host.page.locator('[data-testid="invite-btn"]').click();
  await host.page.waitForSelector('[data-testid="share-qr-img"]'); await host.page.waitForTimeout(500);
  await audit(host.page, `${tag} invite`);
  await host.page.locator('[data-testid="share-close"]').click(); await host.page.waitForTimeout(500);
  await host.page.locator('[data-testid="players-btn"]').click(); await host.page.waitForTimeout(600);
  await audit(host.page, `${tag} players`);
  await host.page.locator('[data-testid="players-close"]').click(); await host.page.waitForTimeout(500);

  // End game is in the toolbar's menu
  await host.page.locator('[data-testid="menu-btn"]').click();
  await host.page.locator('[data-testid="end-game-btn"]').click();
  await host.page.waitForSelector('.end-alert');
  await host.page.locator('.end-alert button:has-text("End game")').click();
  await host.page.waitForSelector('[data-phase="ended"]'); await host.page.waitForTimeout(400);
  await audit(host.page, `${tag} game-over-host`);
  await seeker.page.waitForSelector('[data-phase="ended"]');
  await audit(seeker.page, `${tag} game-over-guest`);

  for (const c of browser.contexts()) await c.close();
}

// Error and removed screens
{
  const ctx = await makePlayer(browser, base);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/lobby/00000000-0000-4000-8000-000000000000`);
  await p.waitForSelector('[data-testid="error-page"]', { timeout: 15000 });
  await audit(p, 'error');
}

await browser.close();
console.log(findings.length ? findings.join('\n') : 'AUDIT: no clipping or overflow');
