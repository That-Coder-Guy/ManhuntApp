import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { withMessage, unreadCount, CHAT_MAX_CHARS, CHAT_HISTORY } from '../src/utils/chat.js';

const require = createRequire(import.meta.url);
const { LIMITS, cleanChatText } = require('../server/game.js');

const message = (id, playerId = 1, text = `message ${id}`) => ({ id, player_id: playerId, name: `Player ${playerId}`, text, at: 1_000_000 + id });

test('the phone and the server agree on the limits', () => {
    assert.equal(CHAT_MAX_CHARS, LIMITS.chatMaxChars);
    assert.equal(CHAT_HISTORY, LIMITS.chatHistory);
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
