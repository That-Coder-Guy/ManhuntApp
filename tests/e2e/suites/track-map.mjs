// Seekers track with the compass or a street map
import { SHOT, createLobby, join, startGame, exactPositions, passGate } from '../lib/helpers.mjs';
import { chromium } from '../lib/playwright.mjs';

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — ${detail}`}`); if (!ok) failures++; };
const waitFor = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const shot = (page, name) => page.screenshot({ path: `${SHOT}/track-${name}.png` });

const SEEKER = { latitude: 39.19, longitude: -96.58 };
const MAYA = { latitude: 39.1915, longitude: -96.5795 };   // ~170 m NNE
const PRIYA = { latitude: 39.1892, longitude: -96.5822 };  // ~200 m SW

const id = await createLobby('Riverside Park');
const seeker = await join(browser, id, SEEKER, { name: 'Hank', host: true, seeker: true });
const maya = await join(browser, id, MAYA, { name: 'Maya' });
const priya = await join(browser, id, PRIYA, { name: 'Priya' });
const page = seeker.page;
// A play area around everyone
await page.evaluate(() => window.__manhuntSocket.emitWithAck('update-settings', { settings: { geofence: { points: [
  { latitude: 39.1935, longitude: -96.5840 }, { latitude: 39.1935, longitude: -96.5770 },
  { latitude: 39.1870, longitude: -96.5770 }, { latitude: 39.1870, longitude: -96.5840 }] } } }));
await exactPositions(page); // pins, distances and directions here are the real ones
await startGame(page, maya.page, priya.page);
await page.waitForSelector('[data-testid="target-card"]');
await page.waitForTimeout(1500);

// Compass is the default
await page.locator('[data-testid="target-card"]', { hasText: 'Maya' }).click();
check(await page.locator('[data-testid="compass-screen"]').getAttribute('data-mode') === 'compass', 'tracking opens on the compass by default');
check(await page.locator('[data-testid="compass-dial"]').count() === 1, 'with the dial');

// Switch to the map
await page.locator('[data-testid="track-map-btn"]').click();
check(await waitFor(page, () => document.querySelector('[data-testid="compass-screen"]')?.dataset.mode === 'map'), 'Map switches to the map');
check(await waitFor(page, () => document.querySelector('[data-testid="track-map"] .leaflet-tile-loaded')), 'street tiles load');
await page.waitForTimeout(900);
const pins = await page.evaluate(() => [...document.querySelectorAll('.track-pin')].map((p) => ({
  tracked: p.classList.contains('track-pin--tracked'), text: p.innerText.trim().replace(/\s+/g, ' ')
})));
check(pins.length === 2, 'both hiders are on the map', JSON.stringify(pins));
check(pins.some((p) => p.tracked && /Maya/.test(p.text)), 'Maya is the tracked pin, with her name', JSON.stringify(pins));
const paths = await page.locator('[data-testid="track-map"] .leaflet-overlay-pane path').count();
check(paths >= 2, 'the play area and the dashed line are drawn', String(paths));
check(await page.locator('[data-testid="compass-dial"]').count() === 0, 'the dial is gone');
const readout = (await page.locator('[data-testid="target-readout"]').innerText()).replace(/\s+/g, ' ');
check(/Maya/.test(readout) && /1[5-9]\d\u202Fm|1[5-9]\d m/.test(readout) && /Head N/.test(readout), 'readout: name, distance and "Head N…"', readout);

// You and the hider are framed, inside the map
const framed = await page.evaluate(() => {
  const map = document.querySelector('.track-map-wrap').getBoundingClientRect();
  const inside = (el) => { const r = el.getBoundingClientRect(); const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2; return cx > map.left && cx < map.right && cy > map.top && cy < map.bottom; };
  const you = [...document.querySelectorAll('[data-testid="track-map"] .leaflet-overlay-pane path')].find((p) => p.getAttribute('fill') === '#ff7b2c');
  return { target: inside(document.querySelector('.track-pin--tracked')), you: !!you && inside(you) };
});
check(framed.target && framed.you, 'you and Maya are both in view', JSON.stringify(framed));
await shot(page, 'map-maya');

// Zoom out to find Priya, then tap her pin to track her instead
await page.locator('[data-testid="track-map"] .leaflet-control-zoom-out').click();
await page.waitForTimeout(500);
check(await page.locator('.track-map-fit--active').count() === 1, 'zooming hands the view to the seeker');
const pinBefore = await page.locator('.track-pin:not(.track-pin--tracked)').elementHandle();
await page.waitForTimeout(2500);
check(await pinBefore.evaluate((el) => el.isConnected), 'pins survive live updates (a tap is never lost)');
await page.locator('.track-pin:not(.track-pin--tracked)').click();
check(await waitFor(page, () => /Priya/.test(document.querySelector('[data-testid="target-readout"]')?.innerText || '')), 'tapping Priya on the map tracks her');
check(await waitFor(page, () => /Priya/.test(document.querySelector('.track-pin--tracked')?.innerText || '')), 'her pin becomes the tracked one');
check(/Head S/.test(await page.locator('[data-testid="target-readout"]').innerText()), 'and the direction turns south-west');

// Pan away, then Fit brings you both back
await page.waitForTimeout(900); // let the reframe animation finish
const box = await page.locator('.track-map-wrap').boundingBox(); // the visible view (the map behind it is a larger turned square)
const from = { x: box.x + box.width - 50, y: box.y + 60 };
await page.mouse.move(from.x, from.y);
await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(from.x - i * 25, from.y + i * 20);
await page.mouse.up();
await page.waitForTimeout(400);
check(await page.locator('.track-map-fit--active').count() === 1, 'after panning, Fit is highlighted');
const pannedAway = await page.evaluate(() => {
  const map = document.querySelector('.track-map-wrap').getBoundingClientRect();
  const r = document.querySelector('.track-pin--tracked')?.getBoundingClientRect();
  return !r || r.right < map.left || r.left > map.right || r.bottom < map.top || r.top > map.bottom;
});
check(pannedAway, 'the pan really moved Priya off screen');
await page.waitForTimeout(2500); // position updates must not yank the view back
check(await page.locator('.track-map-fit--active').count() === 1, 'live updates leave a panned map alone');
await page.locator('[data-testid="track-map-fit"]').click();
await page.waitForTimeout(800);
const back = await page.evaluate(() => {
  const map = document.querySelector('.track-map-wrap').getBoundingClientRect();
  const r = document.querySelector('.track-pin--tracked').getBoundingClientRect();
  return r.left > map.left && r.right < map.right && r.top > map.top && r.bottom < map.bottom;
});
check(back, 'Fit frames you and Priya again');
check(await page.locator('.track-map-fit--active').count() === 0, 'and Fit settles back');

// Centre on me: you in the middle, and the map stays on you as you walk
const mePressed = () => page.locator('[data-testid="track-map-me"]').getAttribute('aria-pressed');
const offCentre = () => page.evaluate(() => {
  const map = document.querySelector('.track-map-wrap').getBoundingClientRect();
  const you = document.querySelector('.track-you').getBoundingClientRect();
  return Math.hypot((you.left + you.right) / 2 - (map.left + map.right) / 2, (you.top + you.bottom) / 2 - (map.top + map.bottom) / 2);
});
check(await offCentre() > 30 && await mePressed() === 'false', 'framed with a hider, you are off to one side', String(await offCentre()));
await page.locator('[data-testid="track-map-me"]').click();
await page.waitForTimeout(900);
check(await offCentre() < 4, 'Centre on me puts you in the middle', String(await offCentre()));
check(await mePressed() === 'true' && await page.locator('.track-map-fit--active').count() === 1, 'its button stays lit, and Fit is the way back');
await shot(page, 'map-centred');
await seeker.ctx.setGeolocation({ latitude: SEEKER.latitude + 0.0005, longitude: SEEKER.longitude + 0.0004 }); // ~65 m off
check(await waitFor(page, () => /2[5-9]\d/.test(document.querySelector('[data-testid="target-readout"]')?.innerText || '')), 'you walk on');
await page.waitForTimeout(1200);
check(await offCentre() < 6 && await mePressed() === 'true', 'and the map follows you', String(await offCentre()));
const middle = { x: box.x + box.width / 2, y: box.y + box.height * 0.75 };
await page.mouse.move(middle.x, middle.y);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(middle.x - i * 12, middle.y - i * 6);
await page.mouse.up();
await page.waitForTimeout(400);
check(await mePressed() === 'false' && await offCentre() > 60, 'dragging the map lets go of you', String(await offCentre()));
await page.locator('[data-testid="track-map-me"]').click();
await page.waitForTimeout(600);
await page.locator('[data-testid="track-map-fit"]').click();
await page.waitForTimeout(800);
check(await mePressed() === 'false' && await page.locator('.track-map-fit--active').count() === 0, 'and so does Fit');
await seeker.ctx.setGeolocation(SEEKER);

// The choice is remembered: back to the list, then a reload
await page.locator('[data-testid="compass-back"]').click();
await page.locator('[data-testid="target-card"]', { hasText: 'Maya' }).click();
check(await page.locator('[data-testid="compass-screen"]').getAttribute('data-mode') === 'map', 'reopening a hider keeps the map');
await page.reload();
await passGate(page);
await page.waitForSelector('[data-testid="target-card"]', { timeout: 15000 });
await page.locator('[data-testid="target-card"]', { hasText: 'Maya' }).click();
check(await page.locator('[data-testid="compass-screen"]').getAttribute('data-mode') === 'map', 'and so does a reload');

// And back to the compass
await page.locator('[data-testid="track-compass"]').click();
check(await waitFor(page, () => document.querySelector('[data-testid="compass-dial"]')), 'Compass brings the dial back');
check(await page.locator('[data-testid="track-map"]').count() === 0, 'and the map goes');
await page.waitForTimeout(3500); // the switch's slide, and the no-sensor needle
await shot(page, 'compass');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
