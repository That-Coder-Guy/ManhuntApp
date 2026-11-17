// Push notifications on this phone: whether they're possible, turning them
// on, and the subscription to hand the server. The server sends them; the
// service worker shows them (public/sw-push.js).

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * 'granted' | 'prompt' | 'denied' | 'unsupported', or 'install' on an iPhone
 * or iPad where Safari only allows notifications for the Home Screen app
 */
export function pushStatus()
{
    if (typeof window === 'undefined') return 'unsupported';
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) return isIOS() && !isInstalled() ? 'install' : 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return 'prompt';
}

// The VAPID public key comes base64url-encoded; subscribe() wants the bytes
function keyBytes(base64url)
{
    const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

const sameKey = (buffer, base64url) =>
{
    if (!buffer) return false;
    const a = new Uint8Array(buffer);
    const b = keyBytes(base64url);
    return a.length === b.length && a.every((byte, i) => byte === b[i]);
};

/**
 * Turn notifications on: asks permission (call it straight from a tap; iOS
 * insists) and subscribes with the server's key. Resolves with the
 * subscription as JSON, or rejects (permission refused, or not possible).
 */
export async function enablePush(publicKey)
{
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing && sameKey(existing.options?.applicationServerKey, publicKey)) return existing.toJSON();
    if (existing) await existing.unsubscribe(); // made for an older server key
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    return subscription.toJSON();
}

/**
 * This phone's subscription for the server's key, if notifications are on;
 * null otherwise. Never asks for permission, so it's safe to call any time.
 */
export async function currentSubscription(publicKey)
{
    if (!publicKey || pushStatus() !== 'granted') return null;
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription && sameKey(subscription.options?.applicationServerKey, publicKey)) return subscription.toJSON();
        // Permission is there but no matching subscription: make one quietly
        return (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })).toJSON();
    } catch {
        return null;
    }
}
