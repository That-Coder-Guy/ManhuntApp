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

/**
 * API response status codes
 */
export const API_RESPONSE_STATUS = {
    SUCCESS: 'success',
    LOBBY_NOT_FOUND: 'lobby_not_found',
    INVALID_PLAYER_TOKEN: 'invalid_player_token',
    HTTP_ERROR: 'http_error',
    NETWORK_ERROR: 'network_error'
};

/**
 * Create a new lobby
 * @param {string} lobbyName - Name of the lobby
 * @returns {Promise<object>} - { lobby_id }
 */
export async function createLobby(lobbyName)
{
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(`${API_BASE}/create-lobby`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lobby_name: lobbyName }),
            signal: controller.signal
        });

        if (!response.ok)
        {
            const error = new Error(`HTTP Status Code ${response.status}`);
            error.status = API_RESPONSE_STATUS.HTTP_ERROR;
            throw error;
        }

        return await response.json();
    } catch (error) {
        if (!error.status)
        {
            const networkError = new Error('Network error - please check your internet connection');
            networkError.status = API_RESPONSE_STATUS.NETWORK_ERROR;
            throw networkError;
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}
