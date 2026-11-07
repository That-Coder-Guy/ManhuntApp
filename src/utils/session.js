/**
 * Per-lobby session in localStorage: the player token (so a reload or a
 * dropped connection resumes the same player) and, for the creator, the host
 * key. Every access is guarded: storage can be full, disabled or throw in
 * private browsing, and a missing session must only ever mean "join as a new
 * player".
 */

const PREFIX = 'manhunt_lobby_';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 10;

const keyFor = (lobbyId) => `${PREFIX}${lobbyId}`;
const optionalString = (value) => value === undefined || typeof value === 'string';

function read(key)
{
    try {
        const data = JSON.parse(localStorage.getItem(key));
        const valid = data && Number.isFinite(data.timestamp)
            && optionalString(data.playerToken) && optionalString(data.hostKey);
        return valid ? data : null;
    } catch {
        return null;
    }
}

function write(key, data)
{
    try {
        localStorage.setItem(key, JSON.stringify({ ...data, timestamp: Date.now() }));
    } catch {
        // Not fatal: the game works, it just can't resume after a reload
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

/** `{ playerToken, hostKey }` for this lobby; either may be null */
export function loadSession(lobbyId)
{
    prune();
    const data = read(keyFor(lobbyId));
    return { playerToken: data?.playerToken ?? null, hostKey: data?.hostKey ?? null };
}

/** Merge fields into this lobby's session */
export function updateSession(lobbyId, patch)
{
    const key = keyFor(lobbyId);
    write(key, { ...read(key), ...patch });
}

/**
 * Forget the player token. The host key is kept unless `everything` is set,
 * so a creator whose player expired still gets the host role back on rejoin.
 */
export function clearSession(lobbyId, { everything = false } = {})
{
    const key = keyFor(lobbyId);
    const hostKey = read(key)?.hostKey;
    if (everything || !hostKey) remove(key);
    else write(key, { hostKey });
}
