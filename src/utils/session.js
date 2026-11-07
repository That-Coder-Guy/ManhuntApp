/**
 * Per-lobby player tokens in localStorage, so a reload or a dropped
 * connection resumes the same player. Every access is guarded: storage can
 * be full, disabled or throw in private browsing, and a missing session must
 * only ever mean "join as a new player".
 */

const PREFIX = 'manhunt_lobby_';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 10;

const keyFor = (lobbyId) => `${PREFIX}${lobbyId}`;

function read(key)
{
    try {
        const data = JSON.parse(localStorage.getItem(key));
        return data && typeof data.playerToken === 'string' && Number.isFinite(data.timestamp) ? data : null;
    } catch {
        return null;
    }
}

function remove(key)
{
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

/** Drop expired or corrupt sessions, and all but the newest few */
function prune()
{
    let keys;
    try {
        // Snapshot first: removing while indexing localStorage skips keys
        keys = Object.keys(localStorage).filter((key) => key.startsWith(PREFIX));
    } catch {
        return;
    }

    const now = Date.now();
    const live = [];
    for (const key of keys)
    {
        const data = read(key);
        if (!data || now - data.timestamp > MAX_AGE_MS) remove(key);
        else live.push({ key, timestamp: data.timestamp });
    }

    live.sort((a, b) => b.timestamp - a.timestamp)
        .slice(MAX_SESSIONS)
        .forEach(({ key }) => remove(key));
}

/** The saved token for this lobby, or null */
export function loadPlayerToken(lobbyId)
{
    prune();
    return read(keyFor(lobbyId))?.playerToken ?? null;
}

export function savePlayerToken(lobbyId, playerToken)
{
    try {
        localStorage.setItem(keyFor(lobbyId), JSON.stringify({ playerToken, timestamp: Date.now() }));
    } catch {
        // Not fatal: the game works, it just can't resume after a reload
    }
}

export function clearPlayerToken(lobbyId)
{
    remove(keyFor(lobbyId));
}
