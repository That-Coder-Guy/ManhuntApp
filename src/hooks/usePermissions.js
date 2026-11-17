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

// ---- What the browser has said, remembered ----
//
// The browser answers "is this allowed?" a moment after the page opens, so
// a switch drawn before then shows the wrong state and visibly jumps. The
// last answer is kept, so switches open in the right state (and are checked
// again straight away, in case it changed in the phone's settings).

const ANSWERS_KEY = 'manhunt.permissionAnswers';

function rememberedAnswer(name)
{
    try { return JSON.parse(localStorage.getItem(ANSWERS_KEY) || '{}')[name] ?? null; } catch { return null; }
}

function rememberAnswer(name, state)
{
    try {
        const answers = JSON.parse(localStorage.getItem(ANSWERS_KEY) || '{}');
        answers[name] = state;
        localStorage.setItem(ANSWERS_KEY, JSON.stringify(answers));
    } catch { /* not remembered */ }
}

/**
 * [state, setState, known] for one browser permission ('geolocation',
 * 'camera'): 'prompt' | 'requesting' | 'granted' | 'denied' | 'unsupported'.
 * `known` is false only while a first-ever answer is on its way.
 */
function useBrowserPermission(name, available)
{
    const canQuery = available && typeof navigator !== 'undefined' && !!navigator.permissions?.query;
    const [state, setRawState] = useState(() => (!available ? 'unsupported' : rememberedAnswer(name) ?? 'prompt'));
    const [known, setKnown] = useState(() => !canQuery || rememberedAnswer(name) !== null);

    const setState = (next) =>
    {
        if (['granted', 'denied', 'prompt'].includes(next)) rememberAnswer(name, next);
        setRawState(next);
    };

    useEffect(() =>
    {
        if (!canQuery) return undefined;
        let permission;
        let cancelled = false;
        const apply = (answer) =>
        {
            if (cancelled) return;
            const next = answer === 'granted' || answer === 'denied' ? answer : 'prompt';
            rememberAnswer(name, next);
            setRawState(next);
            setKnown(true);
        };
        navigator.permissions.query({ name })
            .then((result) =>
            {
                permission = result;
                apply(result.state);
                result.onchange = () => apply(result.state);
            })
            .catch(() => { if (!cancelled) setKnown(true); }); // this browser can't say: 'prompt' until asked
        return () =>
        {
            cancelled = true;
            if (permission) permission.onchange = null;
        };
    }, [name, canQuery]);

    return [state, setState, known];
}

// ---- Location ----

const hasGeolocation = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;

/**
 * Location permission as [status, request, known]: 'prompt' | 'requesting'
 * | 'granted' | 'denied' | 'unsupported', following changes made in the
 * phone's settings. `request()` asks (the browser's own prompt).
 */
export function useLocationPermission()
{
    const [status, setStatus, known] = useBrowserPermission('geolocation', hasGeolocation());

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

    return [status, request, known];
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
const CAMERA_OFF_KEY = 'manhunt.cameraOff';
const cameraWanted = () => read(CAMERA_OFF_KEY) !== '1';

/**
 * Camera as [status, toggle, known]: 'prompt' | 'requesting' | 'granted'
 * (on) | 'off' | 'denied' | 'unsupported'. Allowing it ahead of time is all
 * this does: the QR scanner then opens without the browser asking first. A
 * page can't give the camera back, so off is the app's own setting, and
 * turning it on again doesn't ask.
 */
export function useCameraPermission()
{
    const [permission, setPermission, known] = useBrowserPermission('camera', hasCamera());
    const [wanted, setWanted] = useState(cameraWanted);
    const status = permission === 'granted' && !wanted ? 'off' : permission;

    const toggle = async () =>
    {
        if (status === 'granted' || status === 'off')
        {
            const on = status === 'off';
            write(CAMERA_OFF_KEY, on ? '0' : '1');
            setWanted(on);
            return;
        }
        if (status !== 'prompt') return;
        setPermission('requesting');
        try {
            // Asking means opening it: close it again straight away
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            stream.getTracks().forEach((track) => track.stop());
            write(CAMERA_OFF_KEY, '0');
            setWanted(true);
            setPermission('granted');
        } catch (error) {
            setPermission(error?.name === 'NotAllowedError' ? 'denied' : error?.name === 'NotFoundError' ? 'unsupported' : 'prompt');
        }
    };

    return [status, toggle, known];
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
