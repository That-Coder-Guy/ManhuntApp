// The game server's public address, as the Raspberry Pi publishes it to the
// Vercel site (see api/server-origin.js and scripts/publish-address.mjs)

// Edge Config key the address is stored under
export const SERVER_ORIGIN_KEY = 'server_origin';

/**
 * `value` reduced to a bare origin like https://calm-river.trycloudflare.com,
 * or null if it isn't one. Must be HTTPS: a page served over HTTPS can't talk
 * to a plain http:// server (localhost aside, for development).
 */
export function normalizeServerOrigin(value)
{
    if (typeof value !== 'string' || value.length > 300) return null;
    let url;
    try { url = new URL(value.trim()); } catch { return null; }
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) return null;
    if (url.username || url.password) return null;
    return url.origin;
}
