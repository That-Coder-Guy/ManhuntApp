// What the app may use on this phone, and asking for it.
//
// In the browser they're asked for on entering a lobby ("Before you play",
// PermissionsGate). The installed app asks for them all in one popup the
// first time it opens (PermissionsSetup) instead. Both have them on the
// Settings page.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { pushStatus, notificationsWanted, setNotificationsWanted, disablePush } from '../utils/push';
import { isInstalled } from '../utils/install';
import { permissionRequestRequired, readSavedPermission, savePermission } from './useCompassHeading';

const KEEP_SCREEN_ON_KEY = 'manhunt.keepScreenOn';
const SETUP_DONE_KEY = 'manhunt.setupDone';

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* not remembered */ } };

// ---- Location ----

const hasGeolocation = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;

/**
 * Location permission as 'prompt' | 'requesting' | 'granted' | 'denied' |
 * 'unsupported', following changes made in the phone's settings.
 * `request()` asks (the browser's own prompt).
 */
export function useLocationPermission()
{
    const [status, setStatus] = useState(() => (hasGeolocation() ? 'prompt' : 'unsupported'));

    useEffect(() =>
    {
        if (!hasGeolocation() || !navigator.permissions?.query) return undefined;

        let permission;
        let cancelled = false;
        const apply = (state) => { if (!cancelled) setStatus(state === 'granted' || state === 'denied' ? state : 'prompt'); };

        navigator.permissions.query({ name: 'geolocation' })
            .then((result) =>
            {
                permission = result;
                apply(result.state);
                result.onchange = () => apply(result.state);
            })
            .catch(() => { /* older browsers: 'prompt' until asked */ });

        return () =>
        {
            cancelled = true;
            if (permission) permission.onchange = null;
        };
    }, []);

    const request = () =>
    {
        if (!hasGeolocation() || status === 'requesting' || status === 'granted') return;
        setStatus('requesting');
        navigator.geolocation.getCurrentPosition(
            () => setStatus('granted'),
            (error) => setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'prompt'),
            { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 }
        );
    };

    return [status, request];
}

// ---- Notifications ----

/**
 * Notifications as 'prompt' | 'requesting' | 'granted' (on) | 'off' (allowed,
 * but turned off in the app) | 'denied' | 'unsupported' | 'install' (iPhone,
 * outside the Home Screen app). `toggle()` must be called from a tap: it asks
 * the first time, and after that turns them off and on again. Subscribing
 * happens when a lobby is joined (the server's key comes with it).
 */
const notificationStatus = () =>
{
    const status = pushStatus();
    return status === 'granted' && !notificationsWanted() ? 'off' : status;
};

export function useNotificationPermission()
{
    const [status, setStatus] = useState(notificationStatus);

    const toggle = async () =>
    {
        if (status === 'granted')
        {
            setNotificationsWanted(false);
            setStatus('off');
            await disablePush();
            return 'off';
        }
        if (status === 'off')
        {
            setNotificationsWanted(true);
            setStatus('granted');
            return 'granted';
        }
        if (status !== 'prompt') return status;
        setStatus('requesting');
        try {
            const permission = await Notification.requestPermission();
            const next = permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'prompt';
            if (next === 'granted') setNotificationsWanted(true);
            setStatus(next);
            return next;
        } catch {
            setStatus(notificationStatus());
            return notificationStatus();
        }
    };

    return [status, toggle];
}

// ---- Compass (motion and orientation: iPhone and iPad only ask) ----

/**
 * 'prompt' | 'requesting' | 'granted' | 'denied', or 'unsupported' where
 * the compass needs no permission. `request()` must be called from a tap.
 */
export function useCompassPermission()
{
    const [status, setStatus] = useState(() =>
    {
        if (typeof window === 'undefined' || !permissionRequestRequired()) return 'unsupported';
        return readSavedPermission() === 'granted' ? 'granted' : 'prompt';
    });

    const request = async () =>
    {
        if (status !== 'prompt' && status !== 'denied') return;
        setStatus('requesting');
        try {
            const answer = await DeviceOrientationEvent.requestPermission();
            if (answer === 'granted') savePermission('granted');
            setStatus(answer === 'granted' ? 'granted' : 'denied');
        } catch {
            setStatus('prompt');
        }
    };

    return [status, request];
}

/**
 * The permissions needed to play: location, and on iPhones (the only phones
 * that ask) the compass. { location, compass, ready } for PermissionsList and
 * the button it gates.
 */
export function useRequiredPermissions()
{
    const location = useLocationPermission();
    const compass = useCompassPermission();
    const ready = location[0] === 'granted' && ['granted', 'unsupported'].includes(compass[0]);
    return { location, compass, ready };
}

// ---- Camera (only for scanning join codes) ----

const hasCamera = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/**
 * Camera permission as 'prompt' | 'requesting' | 'granted' | 'denied' |
 * 'unsupported'. Allowing it ahead of time is all this does: the QR scanner
 * then opens without the browser asking first.
 */
export function useCameraPermission()
{
    const [status, setStatus] = useState(() => (hasCamera() ? 'prompt' : 'unsupported'));

    useEffect(() =>
    {
        if (!hasCamera() || !navigator.permissions?.query) return undefined;
        let permission;
        let cancelled = false;
        const apply = (state) => { if (!cancelled) setStatus(state === 'granted' || state === 'denied' ? state : 'prompt'); };
        navigator.permissions.query({ name: 'camera' })
            .then((result) =>
            {
                permission = result;
                apply(result.state);
                result.onchange = () => apply(result.state);
            })
            .catch(() => { /* not every browser can say: 'prompt' until asked */ });
        return () =>
        {
            cancelled = true;
            if (permission) permission.onchange = null;
        };
    }, []);

    const request = async () =>
    {
        if (status !== 'prompt') return;
        setStatus('requesting');
        try {
            // Asking means opening it: close it again straight away
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            stream.getTracks().forEach((track) => track.stop());
            setStatus('granted');
        } catch (error) {
            setStatus(error?.name === 'NotAllowedError' ? 'denied' : error?.name === 'NotFoundError' ? 'unsupported' : 'prompt');
        }
    };

    return [status, request];
}

// ---- Keep the screen on (no permission: a preference, on unless turned off) ----

const screenListeners = new Set();
const subscribeScreen = (listener) => { screenListeners.add(listener); return () => screenListeners.delete(listener); };
const getKeepScreenOn = () => read(KEEP_SCREEN_ON_KEY) !== 'off';

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/** [on, setOn]: whether games keep the screen awake */
export function useKeepScreenOn()
{
    const on = useSyncExternalStore(subscribeScreen, getKeepScreenOn, () => true);
    const setOn = (value) =>
    {
        write(KEEP_SCREEN_ON_KEY, value ? 'on' : 'off');
        screenListeners.forEach((listener) => listener());
    };
    return [on, setOn];
}

// ---- The installed app's first-open setup ----

const setupListeners = new Set();
const subscribeSetup = (listener) => { setupListeners.add(listener); return () => setupListeners.delete(listener); };
const getSetupNeeded = () => typeof window !== 'undefined' && isInstalled() && read(SETUP_DONE_KEY) !== '1';

/** True until the installed app's first-open permissions popup is done */
export function useSetupNeeded()
{
    return useSyncExternalStore(subscribeSetup, getSetupNeeded, () => false);
}

export function finishSetup()
{
    write(SETUP_DONE_KEY, '1');
    setupListeners.forEach((listener) => listener());
}
