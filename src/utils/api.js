// Server origin. Override with VITE_API_ORIGIN (see .env.development for local
// dev); set it to an empty string for single-origin deployments where the
// server also serves this frontend.
function resolveApiOrigin()
{
    const configured = import.meta.env.VITE_API_ORIGIN ?? "https://api.hankinit.work";
    if (!configured) return configured;

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

export const API_ORIGIN = resolveApiOrigin();

// Socket.IO endpoint path on the server
export const SOCKET_PATH = "/manhunt-api/socket.io";

const API_BASE = `${API_ORIGIN}/manhunt-api`;

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(`${API_BASE}/create-lobby`, {
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
