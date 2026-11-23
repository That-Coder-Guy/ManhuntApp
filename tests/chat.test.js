import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { withMessage, unreadCount, inChannel, sideChannel, EVERYONE, CHAT_MAX_CHARS, CHAT_HISTORY } from '../src/utils/chat.js';
import { fitWithin, formatBytes, CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_MAX_SIDE } from '../src/utils/chatImage.js';

const require = createRequire(import.meta.url);
const { LIMITS, cleanChatText, cleanChatImage, CHAT_CHANNELS, chatSide, cleanChatChannel, seesChatMessage } = require('../server/game.js');

// The first bytes of each kind of file, with something after them
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x60, 0x02, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(600, 3)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 1)]);

const message = (id, playerId = 1, text = `message ${id}`) => ({ id, player_id: playerId, name: `Player ${playerId}`, text, at: 1_000_000 + id });

test('the phone and the server agree on the limits', () => {
    assert.equal(CHAT_MAX_CHARS, LIMITS.chatMaxChars);
    assert.equal(CHAT_HISTORY, LIMITS.chatHistory);
    assert.equal(CHAT_IMAGE_MAX_BYTES, LIMITS.chatImageMaxBytes);
    assert.ok(CHAT_IMAGE_MAX_SIDE <= LIMITS.chatImageMaxSide, 'what the phone makes is never bigger than the server takes');
});

test('there is a chat for everyone and one for each side', () => {
    assert.deepEqual(CHAT_CHANNELS, ['all', 'seekers', 'hiders']);
    assert.equal(cleanChatChannel(undefined), 'all', 'none named means everyone');
    assert.equal(cleanChatChannel(null), 'all');
    for (const channel of CHAT_CHANNELS) assert.equal(cleanChatChannel(channel), channel);
    for (const bad of ['', 'spies', 'ALL', 'Seekers', 7, {}, ['all'], true]) assert.equal(cleanChatChannel(bad), null, JSON.stringify(bad));
    assert.equal(chatSide({ is_seeker: true }), 'seekers');
    assert.equal(chatSide({ is_seeker: false }), 'hiders');
    // The phone names the two sides' chats the same way, and reads a message with no channel as everyone's
    assert.deepEqual([sideChannel(true), sideChannel(false), EVERYONE], ['seekers', 'hiders', 'all']);
});

test('a side\'s chat goes to that side, and only from when a player came onto it', () => {
    // (told by the message's number, not its time: see seesChatMessage)
    const said = (channel, id) => ({ id, player_id: 1, name: 'Maya', channel, text: 'x', at: 5 });
    const hider = { is_seeker: false, side_from: 1000 };
    const seeker = { is_seeker: true, side_from: 1000 };

    assert.ok(seesChatMessage(said('all', 5), hider) && seesChatMessage(said('all', 5), seeker), 'everyone gets everyone\'s, whenever it was said');
    assert.ok(seesChatMessage({ id: 1, text: 'old', at: 5 }, seeker), 'a message from before the sides had chats is everyone\'s');
    assert.equal(seesChatMessage(said('hiders', 2000), hider), true);
    assert.equal(seesChatMessage(said('hiders', 2000), seeker), false, 'never the other side');
    assert.equal(seesChatMessage(said('seekers', 2000), seeker), true);
    assert.equal(seesChatMessage(said('seekers', 2000), hider), false);

    // Said before they were on the side: not theirs, though it's their side now
    assert.equal(seesChatMessage(said('hiders', 999), hider), false);
    assert.equal(seesChatMessage(said('hiders', 1000), hider), true);
    // A hider who is caught: the hiders' chat is gone, and the seekers' starts now
    const caught = { is_seeker: true, side_from: 3000 };
    assert.equal(seesChatMessage(said('hiders', 2000), caught), false);
    assert.equal(seesChatMessage(said('hiders', 3500), caught), false);
    assert.equal(seesChatMessage(said('seekers', 2000), caught), false);
    assert.equal(seesChatMessage(said('seekers', 3500), caught), true);

    // On the phone, the list is split by chat
    const list = [said('all', 1), said('hiders', 2), { id: 3, text: 'old', at: 3 }, said('seekers', 4)];
    assert.deepEqual(inChannel(list, 'all').map((m) => m.id), [1, 3]);
    assert.deepEqual(inChannel(list, 'hiders').map((m) => m.id), [2]);
    assert.deepEqual(inChannel(list, 'seekers').map((m) => m.id), [4]);
});

test('a picture for the chat is a small JPEG or WebP, told by its bytes', () => {
    const jpeg = cleanChatImage({ data: JPEG, width: 1280, height: 960 });
    assert.deepEqual([jpeg.type, jpeg.width, jpeg.height, jpeg.bytes.length], ['image/jpeg', 1280, 960, JPEG.length]);
    assert.ok(Buffer.isBuffer(jpeg.bytes));
    assert.equal(cleanChatImage({ data: WEBP, width: 1, height: 1 }).type, 'image/webp');
    // Bytes as they come off any wire, not only as a Buffer
    assert.equal(cleanChatImage({ data: new Uint8Array(JPEG), width: 10, height: 10 }).type, 'image/jpeg');
    // The sender's own word for what it is counts for nothing
    assert.equal(cleanChatImage({ data: JPEG, type: 'text/html', width: 10, height: 10 }).type, 'image/jpeg');
    assert.equal(cleanChatImage({ data: PNG, type: 'image/jpeg', width: 10, height: 10 }), null, 'a PNG is not one of the two');
    assert.equal(cleanChatImage({ data: Buffer.from('<script>alert(1)</script>'), width: 10, height: 10 }), null);

    const most = Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(LIMITS.chatImageMaxBytes - 4)]);
    assert.ok(cleanChatImage({ data: most, width: 10, height: 10 }), 'as big as allowed');
    assert.equal(cleanChatImage({ data: Buffer.concat([most, Buffer.alloc(1)]), width: 10, height: 10 }), null, 'one byte more is refused');

    for (const bad of [null, undefined, 'picture', 7, {}, { data: JPEG }, { data: JPEG, width: 0, height: 10 }, { data: JPEG, width: 10.5, height: 10 },
        { data: JPEG, width: 10, height: LIMITS.chatImageMaxSide + 1 }, { data: JPEG, width: '10', height: 10 },
        { data: Buffer.alloc(0), width: 10, height: 10 }, { data: JPEG.toString('base64'), width: 10, height: 10 }, { data: [0xff, 0xd8, 0xff], width: 10, height: 10 }]) {
        assert.equal(cleanChatImage(bad), null, JSON.stringify(bad)?.slice(0, 50));
    }
});

test('a picture is drawn no bigger than it need be, in its own shape', () => {
    assert.deepEqual(fitWithin(4032, 3024, 1280), { width: 1280, height: 960 }, 'a phone photo, sideways');
    assert.deepEqual(fitWithin(3024, 4032, 1280), { width: 960, height: 1280 }, 'and upright');
    assert.deepEqual(fitWithin(800, 600, 1280), { width: 800, height: 600 }, 'a small one is left alone, never enlarged');
    assert.deepEqual(fitWithin(10000, 10, 1280), { width: 1280, height: 1 }, 'never less than a pixel');
    assert.equal(formatBytes(48_300), '48 KB');
    assert.equal(formatBytes(640), '640 B');
});

test('a message is kept as one tidy line, or refused', () => {
    assert.equal(cleanChatText('  on my way  '), 'on my way');
    assert.equal(cleanChatText('first line\nsecond\tline\r\n'), 'first line second line', 'line breaks and tabs become spaces');
    assert.equal(cleanChatText('a\u0000b\u0007c'), 'a b c', 'control characters too');
    assert.equal(cleanChatText('<b>hi</b> & "you"'), '<b>hi</b> & "you"', 'markup is just text: the app never renders it as HTML');
    assert.equal(cleanChatText('Où es-tu ? 👀'), 'Où es-tu ? 👀');

    for (const bad of ['', '   ', '\n\t', null, undefined, 42, {}, ['hi']]) {
        assert.equal(cleanChatText(bad), null, JSON.stringify(bad));
    }
    assert.equal(cleanChatText('x'.repeat(280)).length, 280);
    assert.equal(cleanChatText('x'.repeat(281)), null, 'too long is refused, not cut');
    // Counted in characters as people see them, so emoji don't count double
    assert.ok(cleanChatText('😀'.repeat(280)));
    assert.equal(cleanChatText('😀'.repeat(281)), null);
});

test('messages arrive in order, once each, and the list stays as long as the server\'s', () => {
    let list = [];
    list = withMessage(list, message(1));
    list = withMessage(list, message(2));
    assert.deepEqual(list.map((m) => m.id), [1, 2]);
    // The same message twice (the history and the live copy crossing on a reconnect)
    assert.equal(withMessage(list, message(2)), list);
    // One that arrives late still lands in its place
    assert.deepEqual(withMessage(withMessage(list, message(4)), message(3)).map((m) => m.id), [1, 2, 3, 4]);
    assert.equal(withMessage(list, null), list);

    let long = [];
    for (let id = 1; id <= CHAT_HISTORY + 5; id++) long = withMessage(long, message(id));
    assert.equal(long.length, CHAT_HISTORY);
    assert.equal(long[0].id, 6, 'the oldest drop off');
});

test('unread counts other people\'s messages since the last one seen', () => {
    const chat = [message(1, 1), message(2, 2), message(3, 1), message(4, 2), message(5, 3)];
    assert.equal(unreadCount(chat, 0, 1), 3, 'not your own');
    assert.equal(unreadCount(chat, 2, 1), 2);
    assert.equal(unreadCount(chat, 5, 1), 0);
    assert.equal(unreadCount([], 0, 1), 0);
});
