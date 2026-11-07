// Lobby IDs are server-generated UUIDs
const LOBBY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The lobby ID in a bare ID or a full invite link (…/lobby/<id>), or null
 * when the text is neither. Typed and scanned input both go through this,
 * so an unrelated QR code or a typo gets a clear message instead of a trip
 * to a lobby that was never going to exist.
 */
export function parseLobbyId(input)
{
    const text = String(input ?? '').trim();
    const raw = text.match(/\/lobby\/([^/?#]+)/)?.[1] ?? text;

    let id = raw;
    try { id = decodeURIComponent(raw); } catch { /* keep the raw text */ }
    return LOBBY_ID_PATTERN.test(id) ? id.toLowerCase() : null;
}

export const lobbyPath = (lobbyId) => `/lobby/${encodeURIComponent(lobbyId)}`;
