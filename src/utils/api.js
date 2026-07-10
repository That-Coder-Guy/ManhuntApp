// Server origin. Override with VITE_API_ORIGIN (see .env.development for local
// dev); set it to an empty string for single-origin deployments where the
// server also serves this frontend.
export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "https://api.hankinit.work";

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
