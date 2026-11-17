// TEMPORARY: the landing page's "Send a test notification" button, to confirm
// notifications reach a phone. Remove this file, its two lines in server.js,
// src/components/TestNotificationButton.jsx and its line in src/pages/Home.jsx
// once confirmed.

const { cleanSubscription } = require('./push');

// At most this many waiting at once, and one per phone
const MAX_PENDING = 20;

/**
 * GET  <prefix>/test-push/key  → { public_key }
 * POST <prefix>/test-push      { subscription } → sends a test notification
 *                              to it after `delayMs`
 * Returns close(), which cancels any still waiting.
 */
function addTestPushRoutes(app, prefix, push, { delayMs = 30_000 } = {})
{
    const pending = new Map(); // endpoint → timer

    app.get(`${prefix}/test-push/key`, (req, res) =>
    {
        if (!push) return res.status(404).json({ status: 'unavailable', description: 'This server does not send notifications.' });
        res.json({ status: 'success', public_key: push.publicKey });
    });

    app.post(`${prefix}/test-push`, (req, res) =>
    {
        if (!push) return res.status(404).json({ status: 'unavailable', description: 'This server does not send notifications.' });
        const subscription = cleanSubscription(req.body?.subscription);
        if (!subscription) return res.status(400).json({ status: 'validation_error', description: 'Not a push subscription this server accepts.' });
        if (!pending.has(subscription.endpoint) && pending.size >= MAX_PENDING)
        {
            return res.status(429).json({ status: 'busy', description: 'Too many test notifications waiting. Try again in a minute.' });
        }

        clearTimeout(pending.get(subscription.endpoint));
        pending.set(subscription.endpoint, setTimeout(() =>
        {
            pending.delete(subscription.endpoint);
            push.send(subscription, {
                title: 'Test notification',
                body: 'Notifications work on this phone.',
                url: '/',
                tag: 'manhunt-test'
            }, { ttl: 60 });
        }, delayMs));
        res.json({ status: 'success', delay_s: Math.round(delayMs / 1000) });
    });

    return function close()
    {
        for (const timer of pending.values()) clearTimeout(timer);
        pending.clear();
    };
}

module.exports = { addTestPushRoutes };
