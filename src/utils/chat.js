// The lobby's chats: one conversation for everyone in it, and one for each
// side that only that side is sent. The server keeps the messages
// ([{ id, player_id, name, channel, text, at, image? }], oldest first), and
// sends a phone the ones it may have on joining, each new one as it's sent,
// and the lot again whenever its player changes sides (server/server.js).
// `channel` is 'all', 'seekers' or 'hiders'.
// A message with a picture carries only where it is and its size
// (`image: { id, type, width, height }`, or `gone` once the server has let
// it go); the picture itself is fetched when it's shown (utils/chatImage.js).

// Mirrors the server's limits (server/game.js)
export const CHAT_MAX_CHARS = 280;
export const CHAT_HISTORY = 200;

export const EVERYONE = 'all';

/** The chat a side has to itself: 'seekers' or 'hiders' */
export const sideChannel = (isSeeker) => (isSeeker ? 'seekers' : 'hiders');

/** The messages of one chat ('all', 'seekers' or 'hiders'), in order */
export function inChannel(messages, channel)
{
    return messages.filter((m) => (m.channel ?? EVERYONE) === channel);
}

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
// reload doesn't mark the whole conversation unread again. Everyone's chat
// and the player's side's are kept apart (`side`): one can be read and the
// other not. (Message IDs only ever go up, across all the chats, so one
// number does for the side's chat whichever side that is.)
const readKey = (lobbyId, side) => `manhunt.chatRead.${lobbyId}${side ? '.side' : ''}`;

export function loadLastRead(lobbyId, side = false)
{
    try { return Number(localStorage.getItem(readKey(lobbyId, side))) || 0; } catch { return 0; }
}

export function saveLastRead(lobbyId, id, side = false)
{
    try { localStorage.setItem(readKey(lobbyId, side), String(id)); } catch { /* not remembered */ }
}
