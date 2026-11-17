// Web Push: notifications sent from this server through each browser's push
// service (Apple, Google, Mozilla, Microsoft), which wake the phone's service
// worker just long enough to show them. No app has to be running.

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

// Push services a subscription may point at. The server POSTs to whatever
// endpoint a player hands it, so anything else is refused: otherwise a player
// could make this machine send requests into the network it sits on
const PUSH_SERVICE_HOSTS = [
    /^web\.push\.apple\.com$/,
    /(^|\.)push\.apple\.com$/,
    /^fcm\.googleapis\.com$/,
    /^android\.googleapis\.com$/,
    /(^|\.)push\.services\.mozilla\.com$/,
    /(^|\.)notify\.windows\.com$/,
];

const MAX_SUBSCRIPTION_CHARS = 2000;
const BASE64URL = /^[A-Za-z0-9_-]+=*$/;

/**
 * A browser's PushSubscription (as JSON) reduced to what sending needs, or
 * null if it isn't one, or points anywhere but a known push service.
 */
function cleanSubscription(subscription)
{
    if (!subscription || typeof subscription !== 'object') return null;
    if (JSON.stringify(subscription).length > MAX_SUBSCRIPTION_CHARS) return null;
    const { endpoint, keys } = subscription;
    let url;
    try { url = new URL(endpoint); } catch { return null; }
    if (url.protocol !== 'https:' || !PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname))) return null;
    if (typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') return null;
    if (!BASE64URL.test(keys.p256dh) || !BASE64URL.test(keys.auth)) return null;
    return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/**
 * The server's VAPID key pair, which signs every push. It must stay the same
 * across restarts, or phones' subscriptions stop working: taken from
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, else made once and kept in keysFile.
 */
function loadVapidKeys(keysFile)
{
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    {
        return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    }
    try {
        const saved = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
        if (saved.publicKey && saved.privateKey) return saved;
    } catch { /* first run: make them */ }
    const keys = webpush.generateVAPIDKeys();
    try {
        fs.writeFileSync(keysFile, JSON.stringify(keys), { mode: 0o600 });
    } catch (error) {
        console.warn(`Couldn't save the push keys to ${keysFile} (${error.message}); phones will need to subscribe again after a restart.`);
    }
    return keys;
}

/**
 * The real sender: { publicKey, send(subscription, payload) }. send resolves
 * with { ok } or { gone } (the browser dropped that subscription: forget it);
 * it never rejects.
 */
function createPushSender({ keysFile = path.join(__dirname, '.vapid-keys.json'), subject } = {})
{
    const keys = loadVapidKeys(keysFile);
    // Push services want a contact for the sender; the project's page will do
    const vapidSubject = subject || process.env.VAPID_SUBJECT || 'https://github.com/That-Coder-Guy/ManhuntApp';
    webpush.setVapidDetails(vapidSubject, keys.publicKey, keys.privateKey);

    return {
        publicKey: keys.publicKey,
        async send(subscription, payload)
        {
            try {
                await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 10 * 60, urgency: 'high' });
                return { ok: true };
            } catch (error) {
                if (error.statusCode === 404 || error.statusCode === 410) return { gone: true };
                console.warn(`Push failed (${error.statusCode || error.message})`);
                return { ok: false };
            }
        }
    };
}

module.exports = { cleanSubscription, createPushSender, PUSH_SERVICE_HOSTS };
