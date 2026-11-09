#!/usr/bin/env node
/**
 * Renders public/icon.svg into the PNG icons the app ships:
 *   icon-512.png, icon-192.png  web app manifest (also used as maskable)
 *   apple-touch-icon.png        iOS Home Screen, 180×180
 *   favicon-32.png              browser tabs that don't take the SVG
 *                               (from public/favicon.svg, the simplified tab version)
 *
 *   npm run icons
 *
 * Needs Playwright with Chromium, like the walkthrough screenshots.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PUBLIC = new URL('../public/', import.meta.url);
const SIZES = [
    ['icon.svg', 'icon-512.png', 512],
    ['icon.svg', 'icon-192.png', 192],
    ['icon.svg', 'apple-touch-icon.png', 180],
    ['favicon.svg', 'favicon-32.png', 32]
];

async function loadPlaywright()
{
    try { return await import('playwright'); } catch { /* try require, which honours NODE_PATH */ }
    try { return require('playwright'); } catch { /* not installed */ }
    console.error('Playwright is needed: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

for (const [source, file, size] of SIZES) {
    const svg = await readFile(new URL(source, PUBLIC), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}
        svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    // Transparent outside the art: the favicon's rounded corners stay see-through
    await page.screenshot({ path: new URL(file, PUBLIC).pathname, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`  ✓ public/${file} (${size}×${size})`);
}

await browser.close();
