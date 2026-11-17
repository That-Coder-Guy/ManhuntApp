// Playwright, wherever it's installed: the project, or a global install on
// NODE_PATH (as scripts/capture-walkthrough.mjs finds it)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function loadPlaywright()
{
    try { return await import('playwright'); } catch { /* try require, which honours NODE_PATH */ }
    try { return require('playwright'); } catch { /* not installed */ }
    console.error('Playwright is needed: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
}

export const { chromium } = await loadPlaywright();
