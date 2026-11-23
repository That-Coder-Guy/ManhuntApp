---
tags: [manhunt, feature]
---
# Chat

One conversation for everyone in a lobby: seekers and hiders alike, before, during and after a game. Added 2026-11-21: the owner asked for "a global chat feature". Since 2026-11-22 each side also has a chat of its own: see "A chat for each side" below.

## How it works
- **A chat button** (speech bubble) leads the lobby's toolbar. It carries a count of messages from other players since this player last had the chat open ("9+" past nine).
- **The sheet**: the conversation, newest at the bottom, your own messages on the right as "You". Under it, a box (280 characters) and **Send**; Enter sends too. During a game each message says which side its sender is on *now*.
- **Global means everyone.** "Global" was read as the whole lobby, as opposed to one side. Nothing stops a player giving their side away in it: that is theirs to judge. (Each side's own chat came the day after.)
- A message keeps the name it was sent under; while its sender is still in the lobby the sheet shows their current name.

## On the server
- The lobby keeps its last **200** messages in memory (`lobby.chat`), for as long as the lobby lives, across rounds. Nothing is written to disk.
- `chat-send` `{ text }`: the text is made one line (line breaks, tabs and control characters become spaces), trimmed, and refused if empty or over 280 characters (`cleanChatText` in `server/game.js`; too long is refused, not cut). Then `chat-message` goes to everyone in the lobby, the sender included.
- `chat-history` is sent on every connection, so a player who joins late, reloads or drops out and back has the conversation.
- **No flooding:** five messages in five seconds from one player, then `too_fast` until the oldest of those is five seconds old.
- Messages are shown with React text nodes, never as HTML.

## A chat for each side (2026-11-22)
The owner asked for "a seekers only and hiders only chat".

- **The sheet has a switch**: **Everyone**, and **Seekers** or **Hiders**, whichever the player is. It opens on Everyone. The box says who it writes to ("Message the hiders"), an empty side chat says who sees it, and the tab not showing carries a count of what's new in it. The toolbar's count is both together. Each chat is read separately (`manhunt.chatRead.<lobby>` and `manhunt.chatRead.<lobby>.side`).
- **The other side is never sent it.** A message has a `channel`: `all`, `seekers` or `hiders`. One for a side is emitted only to the sockets of players on that side, never to the lobby's room, and the history a phone is given leaves the other side's out (`seesChatMessage` in `server/game.js`, `chatFor` in `server.js`). The browser suite listens on each phone's socket and checks nothing of the other side's ever arrives.
- **A side's chat is yours only from when you came onto it.** Each player has `side_from`: the number the next message had when they joined that side. They're given their side's messages from that number on. So:
  - a seeker can't turn hider in the lobby, read the hiders' plans and turn back: they'd see only what was said while they were visibly a hider;
  - a hider who is caught gets none of the seekers' earlier talk, and the hiders' chat goes from their phone (the same reasoning as the [[Hider map]]: nobody crosses over knowing more than they did);
  - someone who joins late gets everyone's chat, and their side's from then on;
  - going back to the lobby after a game puts found hiders back among the hiders, starting again.
  A message *number*, not a time: the first version compared times, and a message sent in the same millisecond as a hider being caught reached them. The server test caught it.
- **On changing sides the server sends that phone `chat-history` again**, which replaces its list. The sheet goes back to Everyone, and anything half-written is dropped: words meant for the hiders must not be one tap from the seekers' chat.
- **The channel is named by the sender, never worked out from their side.** `chat-send` with `channel: 'hiders'` from someone who has just become a seeker is refused (`wrong_side`), not delivered to the seekers.
- All three chats share the lobby's 200 messages and 40 pictures. A picture sent to one side is fetched by its random ID like any other; the other side is never told the ID.
- Not done: no way to message one player; the host sees only their own side's chat, like anyone.

## Pictures (2026-11-22)
The owner asked to "send images in the chat", for others to "click on these image to Fullscreen them", with the image "highly compressed using something like JPEG XL or something smaller".

- **Sending.** A picture button left of the box opens the phone's own chooser (camera or library). The chosen picture waits above the box with its size ("Picture · 50 KB") and a remove button, and goes with the next **Send**, with words or without.
- **Compression, on the phone** (`src/utils/chatImage.js`): drawn at no more than **1280 px** on its longer side, then encoded at quality 0.6, 0.45, 0.3 until it is **60 KB or less**; if it still isn't, it is drawn 20% smaller and tried again, down to 320 px. A phone photo of several megabytes goes out at about a hundredth of its size.
- **The format is WebP, with JPEG as the fallback, not JPEG XL.** No browser can *make* a JPEG XL or an AVIF without a large encoder shipped with the app, and Chrome and Android browsers don't *show* JPEG XL (as far as was known when this was written; worth checking again later). WebP is what browsers can make themselves, and is a quarter to a third smaller than a JPEG that looks the same. A browser asked for a type it can't make hands back a PNG, which is how the fallback is chosen. Don't swap in a WASM AVIF or JXL encoder without weighing its size against the app's.
- **On the server** (`cleanChatImage` in `server/game.js`): the bytes come with `chat-send` as `image: { data, width, height }`. Kept only if they are at most **72,000 bytes** and begin as a JPEG or a WebP: the type is read from the bytes, never taken from the sender. Width and height (1 to 4096) are the sender's word, used only to keep the picture's room before it loads.
- **Pictures don't travel with the messages.** The message carries `image: { id, type, width, height }`; the bytes are fetched from `GET /manhunt-api/chat-image/<lobby>/<id>` when shown (`immutable`, so a phone keeps its copy; `nosniff`). So the history sent on every connection stays small. The ID is random, and the lobby's ID is the invite: whoever has both can fetch it, which is everyone in the lobby and no one else.
- **Limits.** A lobby keeps its newest **40** pictures (about 3 MB at most), in memory like the rest. An older one is dropped while its message stays, marked `image.gone`, and shows "Picture no longer kept". A message that drops off the 200 takes its picture with it. One player can send **four pictures in 30 seconds**, on top of the five-messages rule.
- **In the conversation** a picture is shown at most 15rem wide and 18rem tall, in its own shape. Its box is sized from the width and height in the message, not by the picture once loaded: sized by the picture, the box was empty until it arrived, and the chat had already scrolled "to the end" a picture's height short.
- **A picture with no words is the narrowest message there is** (2026-11-22, the owner: such messages should be "as small as possible", down to where the header's left and right text come "within 3 spaces worth of width of each other"). That width is the header at its tightest: name and side at the left, the time at the right, three spaces between (`3ch` of the time's monospace, as padding on `.chat-time`, for every message). The picture fills it, about 155 px with a short name. `.chat-message--picture` does it: the picture's wrapper has `width: 0; min-width: 100%`, so it takes the message's width without adding to it. A picture with words keeps the larger size above: there the wrapper's width is the picture's most (`--chat-image-width`, lengths only), which is what widens the message. Don't put a percentage in that width: how a percentage inside `min()` counts towards a shrink-to-fit parent differed between a direct child and a wrapped one in Chromium, and a captioned picture came out header-narrow.
- **Full screen.** Tapping a picture opens it in a second sheet that covers the screen, all of it showing (`object-fit: contain`) on black; tapping it again, or **Close**, goes back. It is the page's own full screen, not the browser's: iPhones don't allow that for pictures. No pinch-zoom or saving.
- The server's socket limit (`maxHttpBufferSize`, 100 kB) is why 72 KB is the ceiling; a picture gets 30 seconds to be acknowledged, where everything else gets 8.

## The unread count
The id of the last message seen is kept per lobby in `localStorage` (`manhunt.chatRead.<lobby>`), so a reload doesn't mark everything unread again. A player's own messages never count.

## Not done
- No notification, sound or buzz for a new message: only the count on the button. A phone in a pocket won't know.
- No push to a locked phone, no muting, no deleting, no reporting. The host can still remove a player from the lobby.
- Untested on real phones (the keyboard over the box in particular, and choosing a picture from the camera or library in the browser and in both native apps); checked by `tests/chat.test.js`, six tests in `tests/server.test.js`, and `tests/e2e/suites/chat.mjs` and `team-chat.mjs`.

Code: `ChatModal.jsx`, `src/utils/chat.js`, `src/utils/chatImage.js`, the `chat-send` handler and the `chat-image` route in `server/server.js`, `useLobbySocket.js` (`chat`, `sendChat`).
