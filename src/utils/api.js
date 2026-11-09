import { normalizeServerOrigin } from '../../shared/serverOrigin.js';

// Where the game server is. VITE_API_ORIGIN is read at build time:
//   https://… — a fixed server address
//   (empty)   — the server also serves this frontend (single origin)
//   auto      — ask /api/server-origin when the app starts. For a frontend on
//               Vercel with the server behind a Cloudflare quick tunnel, whose
//               address changes; the server publishes it (see README).
const CONFIGURED_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "https://api.hankinit.work";
const DISCOVER = CONFIGURED_ORIGIN === "auto";

function fixedApiOrigin()
{
    const configured = CONFIGURED_ORIGIN;
    if (!configured) return window.location.origin;

    // In dev the configured origin is localhost, which other devices on the
    // LAN can't reach. When the page was loaded from a LAN address (phone on
    // the same network hitting the Vite host), target the API on that same
    // host instead so those devices get a working backend too.
    try {
        const configuredUrl = new URL(configured);
        const pageHost = window.location.hostname;
        const isConfiguredLocal = configuredUrl.hostname === "localhost" || configuredUrl.hostname === "127.0.0.1";
        const isPageLocal = pageHost === "localhost" || pageHost === "127.0.0.1";
        const isLanHost = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(pageHost) || pageHost.endsWith(".local");

        if (isConfiguredLocal && !isPageLocal && isLanHost) {
            return `${window.location.protocol}//${pageHost}:${configuredUrl.port}`;
        }
    } catch {
        // Fall through to the configured value
    }

    return configured;
}

const DISCOVERY_URL = "/api/server-origin";
const DISCOVERY_TIMEOUT_MS = 5000;
// The last address discovery returned, for when the lookup itself fails on a
// weak connection
const SAVED_ORIGIN_KEY = "manhunt.serverOrigin";

let discovered = null; // promise of the address found this page load

async function discoverApiOrigin()
{
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
    try {
        const response = await fetch(DISCOVERY_URL, { cache: "no-store", signal: controller.signal });
        const data = response.ok ? await response.json() : null;
        const origin = normalizeServerOrigin(data?.origin);
        if (origin) {
            try { localStorage.setItem(SAVED_ORIGIN_KEY, origin); } catch { /* storage unavailable */ }
            return origin;
        }
        if (response.ok) throw requestError("The game server isn't online right now", "server_offline");
    } catch (error) {
        if (error.status === "server_offline") throw error;
        // Couldn't ask: fall back to the last known address
    } finally {
        clearTimeout(timeoutId);
    }
    let saved = null;
    try { saved = normalizeServerOrigin(localStorage.getItem(SAVED_ORIGIN_KEY)); } catch { /* storage unavailable */ }
    if (saved) return saved;
    throw requestError("Network error: check your connection", "network_error");
}

/**
 * Resolves with the game server's origin. With discovery, a successful lookup
 * is kept for the rest of the page load; a failed one is retried next call.
 */
export function getApiOrigin()
{
    if (!DISCOVER) return Promise.resolve(fixedApiOrigin());
    if (!discovered) {
        discovered = discoverApiOrigin();
        discovered.catch(() => { discovered = null; });
    }
    return discovered;
}

// Socket.IO endpoint path on the server
export const SOCKET_PATH = "/manhunt-api/socket.io";

// How long to wait before giving up on a REST request
const REQUEST_TIMEOUT_MS = 8000;

function requestError(message, status)
{
    const error = new Error(message);
    error.status = status;
    return error;
}

/**
 * Create a lobby and resolve with `{ lobby_id, host_key }`. The host key is
 * what makes the creator the host, so it is stored with the session. Rejects with
 * status 'network_error' (offline, timed out) or 'http_error' (the server
 * answered, but not with a lobby).
 */
export async function createLobby(lobbyName)
{
    const apiBase = `${await getApiOrigin()}/manhunt-api`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(`${apiBase}/create-lobby`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lobby_name: lobbyName }),
            signal: controller.signal
        });
    } catch {
        throw requestError('Network error: check your connection', 'network_error');
    } finally {
        clearTimeout(timeoutId);
    }

    const data = response.ok ? await response.json().catch(() => null) : null;
    if (typeof data?.lobby_id !== 'string' || typeof data?.host_key !== 'string')
    {
        throw requestError(`Unexpected response (HTTP ${response.status})`, 'http_error');
    }
    return data;
}
