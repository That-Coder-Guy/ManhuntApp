// The native iPhone and Android apps (ios/, android/) show this web app in a
// web view, and run a small script of their own in the page first
// (bridge.js), which leaves a few functions on window.__manhuntNative. This
// is the one place the web app looks for them, so it runs the same without.

/**
 * A function that opens the phone's own settings for Manhunt, or null in a
 * browser, which has no way to open its settings from a page. Called plainly,
 * the app first says what Manhunt needs there (for a blocked permission);
 * with `{ direct: true }` it goes straight there (the page has already said
 * why).
 */
export function phoneSettingsOpener()
{
    const open = typeof window !== 'undefined' ? window.__manhuntNative?.openSettings : null;
    return typeof open === 'function' ? ({ direct = false } = {}) => open({ direct }) : null;
}
