---
tags: [manhunt, feature]
---
# Chat

One conversation for everyone in a lobby: seekers and hiders alike, before, during and after a game. Added 2026-11-21: the owner asked for "a global chat feature".

## How it works
- **A chat button** (speech bubble) leads the lobby's toolbar. It carries a count of messages from other players since this player last had the chat open ("9+" past nine).
- **The sheet**: the conversation, newest at the bottom, your own messages on the right as "You". Under it, a box (280 characters) and **Send**; Enter sends too. During a game each message says which side its sender is on *now*.
- **Global means everyone.** "Global" was read as the whole lobby, as opposed to one side. There is no hiders-only or seekers-only chat. Nothing stops a player giving their side away in it: that is theirs to judge.
- A message keeps the name it was sent under; while its sender is still in the lobby the sheet shows their current name.

## On the server
- The lobby keeps its last **200** messages in memory (`lobby.chat`), for as long as the lobby lives, across rounds. Nothing is written to disk.
- `chat-send` `{ text }`: the text is made one line (line breaks, tabs and control characters become spaces), trimmed, and refused if empty or over 280 characters (`cleanChatText` in `server/game.js`; too long is refused, not cut). Then `chat-message` goes to everyone in the lobby, the sender included.
- `chat-history` is sent on every connection, so a player who joins late, reloads or drops out and back has the conversation.
- **No flooding:** five messages in five seconds from one player, then `too_fast` until the oldest of those is five seconds old.
- Messages are shown with React text nodes, never as HTML.

## The unread count
The id of the last message seen is kept per lobby in `localStorage` (`manhunt.chatRead.<lobby>`), so a reload doesn't mark everything unread again. A player's own messages never count.

## Not done
- No notification, sound or buzz for a new message: only the count on the button. A phone in a pocket won't know.
- No push to a locked phone, no muting, no deleting, no reporting. The host can still remove a player from the lobby.
- Untested on real phones (the keyboard over the box in particular); checked by `tests/chat.test.js`, two tests in `tests/server.test.js` and `tests/e2e/suites/chat.mjs`.

Code: `ChatModal.jsx`, `src/utils/chat.js`, the `chat-send` handler in `server/server.js`, `useLobbySocket.js` (`chat`, `sendChat`).
