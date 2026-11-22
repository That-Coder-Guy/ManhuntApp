// The lobby's chat: one conversation for everyone in it. The server keeps
// the messages ([{ id, player_id, name, text, at, image? }], oldest first) and
// sends the lot on joining and each new one as it's sent (server/server.js).
// A message with a picture carries only where it is and its size
// (`image: { id, type, width, height }`, or `gone` once the server has let
// it go); the picture itself is fetched when it's shown (utils/chatImage.js).

// Mirrors the server's limits (server/game.js)
export const CHAT_MAX_CHARS = 280;
export const CHAT_HISTORY = 200;

/**
 * The list with a newly arrived message on the end. One already there (the
 * history and the live message can cross on a reconnect) isn't added twice,
 * and the list never outgrows what the server keeps.
 */
export function withMessage(messages, message)
{
    if (!message || messages.some((m) => m.id === message.id)) return messages;
    return [...messages, message].sort((a, b) => a.id - b.id).slice(-CHAT_HISTORY);
}

/** How many messages from other players came after the last one this player has seen */
export function unreadCount(messages, lastReadId, selfId)
{
    return messages.filter((m) => m.id > lastReadId && m.player_id !== selfId).length;
}

/** "14:05": when a message was sent, by this phone's clock and in its own hour style */
export function messageTime(at)
{
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Where the last message this player saw is remembered, per lobby, so a
// reload doesn't mark the whole conversation unread again
const readKey = (lobbyId) => `manhunt.chatRead.${lobbyId}`;

export function loadLastRead(lobbyId)
{
    try { return Number(localStorage.getItem(readKey(lobbyId))) || 0; } catch { return 0; }
}

export function saveLastRead(lobbyId, id)
{
    try { localStorage.setItem(readKey(lobbyId), String(id)); } catch { /* not remembered */ }
}
