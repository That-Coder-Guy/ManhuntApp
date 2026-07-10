import { useCallback, useEffect, useRef, useState } from 'react';
import { headingFromEuler, applyScreenRotation, smoothHeading } from '../utils/orientation';

export const COMPASS_STATUS = {
    UNKNOWN: 'unknown',         // iOS: waiting for a user tap to request permission
    GRANTED: 'granted',
    DENIED: 'denied',
    UNSUPPORTED: 'unsupported'  // no usable orientation source on this device
};

const PERMISSION_STORAGE_KEY = 'manhunt_compass_permission';

// If listeners are attached but no usable event arrives in this window, the
// device has no absolute orientation source (e.g. no magnetometer)
const DETECTION_TIMEOUT_MS = 3000;

// iOS webkitCompassHeading is already sensor-fused and filtered; raw Android
// magnetometer output is noisy and needs heavier smoothing
const SMOOTHING_WEBKIT = 0.8;
const SMOOTHING_STANDARD = 0.35;

// Heading sources in priority order. Once a better source produces data,
// events from lesser sources are ignored so they can never fight each other.
const SOURCE_PRIORITY = {
    none: 0,
    'fallback-absolute': 1, // deviceorientation events flagged absolute (Firefox Android)
    absolute: 2,            // deviceorientationabsolute (Chrome/Samsung on Android)
    webkit: 3               // webkitCompassHeading (iOS)
};

function getScreenAngle()
{
    if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
        return screen.orientation.angle;
    }
    if (typeof window !== 'undefined' && typeof window.orientation === 'number') {
        return window.orientation;
    }
    return 0;
}

// iOS 13+ is the only platform with a permission gate for orientation events
function permissionRequestRequired()
{
    return typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function';
}

/**
 * Cross-platform compass heading (degrees clockwise from north, screen-
 * rotation compensated and smoothed), hiding every platform difference:
 *
 * - iOS: `webkitCompassHeading` from `deviceorientation`, behind the iOS
 *   permission prompt (requested via the returned `requestPermission`, which
 *   must be called from a user gesture the first time).
 * - Android/standard: tilt-compensated heading computed from
 *   `deviceorientationabsolute` Euler angles; `deviceorientation` events are
 *   used only when flagged `absolute` (Firefox). Relative orientation events
 *   are NEVER used — their alpha has an arbitrary zero.
 * - Capability is detected at runtime: if no usable event arrives shortly
 *   after listening starts, status becomes 'unsupported'.
 */
function useCompassHeading()
{
    const [heading, setHeading] = useState(null);
    const [status, setStatus] = useState(() =>
    {
        if (typeof window === 'undefined') return COMPASS_STATUS.UNSUPPORTED;
        if (!window.DeviceOrientationEvent) return COMPASS_STATUS.UNSUPPORTED;
        if (permissionRequestRequired()) {
            return localStorage.getItem(PERMISSION_STORAGE_KEY) === 'denied'
                ? COMPASS_STATUS.DENIED
                : COMPASS_STATUS.UNKNOWN;
        }
        return COMPASS_STATUS.GRANTED; // no permission gate — listen immediately
    });
    // 'webkit' | 'absolute' | 'fallback-absolute' | 'none' — which event source won
    const [source, setSource] = useState('none');

    const headingRef = useRef(null);
    const sourceRef = useRef('none');
    const detectionTimerRef = useRef(null);

    const applyReading = useCallback((eventSource, rawHeading) =>
    {
        if (rawHeading == null) return; // unusable reading (near-vertical) — hold last heading

        if (SOURCE_PRIORITY[eventSource] < SOURCE_PRIORITY[sourceRef.current]) return;
        if (sourceRef.current !== eventSource) {
            sourceRef.current = eventSource;
            setSource(eventSource);
        }

        if (detectionTimerRef.current) {
            clearTimeout(detectionTimerRef.current);
            detectionTimerRef.current = null;
        }

        const adjusted = applyScreenRotation(rawHeading, getScreenAngle());
        const factor = eventSource === 'webkit' ? SMOOTHING_WEBKIT : SMOOTHING_STANDARD;
        const smoothed = smoothHeading(headingRef.current, adjusted, factor);

        // Skip sub-half-degree changes to avoid re-rendering at sensor rate
        if (headingRef.current !== null) {
            let delta = Math.abs(smoothed - headingRef.current) % 360;
            if (delta > 180) delta = 360 - delta;
            if (delta < 0.5) return;
        }

        headingRef.current = smoothed;
        setHeading(smoothed);
    }, []);

    // Attach orientation listeners while granted
    useEffect(() =>
    {
        if (status !== COMPASS_STATUS.GRANTED || typeof window === 'undefined') {
            return undefined;
        }

        const handleOrientation = (event) =>
        {
            if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
                // Already a true heading, clockwise from north
                applyReading('webkit', event.webkitCompassHeading);
            } else if (event.absolute === true && event.alpha !== null) {
                applyReading('fallback-absolute', headingFromEuler(event.alpha, event.beta));
            }
            // Relative readings are ignored entirely: alpha's zero is arbitrary
        };

        const handleOrientationAbsolute = (event) =>
        {
            if (event.alpha !== null) {
                applyReading('absolute', headingFromEuler(event.alpha, event.beta));
            }
        };

        const attachListeners = () =>
        {
            window.addEventListener('deviceorientation', handleOrientation, true);
            window.addEventListener('deviceorientationabsolute', handleOrientationAbsolute, true);
        };

        const detachListeners = () =>
        {
            window.removeEventListener('deviceorientation', handleOrientation, true);
            window.removeEventListener('deviceorientationabsolute', handleOrientationAbsolute, true);
        };

        attachListeners();

        // Runtime capability detection: listeners attached but silent means no
        // absolute orientation source exists on this device
        if (sourceRef.current === 'none') {
            detectionTimerRef.current = setTimeout(() =>
            {
                detectionTimerRef.current = null;
                if (sourceRef.current === 'none') {
                    setStatus(COMPASS_STATUS.UNSUPPORTED);
                }
            }, DETECTION_TIMEOUT_MS);
        }

        const handleVisibilityChange = () =>
        {
            if (document.visibilityState === 'visible') {
                detachListeners();
                attachListeners();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () =>
        {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            detachListeners();
            if (detectionTimerRef.current) {
                clearTimeout(detectionTimerRef.current);
                detectionTimerRef.current = null;
            }
        };
    }, [status, applyReading]);

    const requestPermission = useCallback(async () =>
    {
        if (!permissionRequestRequired()) {
            return;
        }

        try {
            const permissionState = await DeviceOrientationEvent.requestPermission();
            if (permissionState === 'granted') {
                localStorage.setItem(PERMISSION_STORAGE_KEY, 'granted');
                setStatus(COMPASS_STATUS.GRANTED);
            } else {
                localStorage.setItem(PERMISSION_STORAGE_KEY, 'denied');
                setStatus(COMPASS_STATUS.DENIED);
            }
        } catch (error) {
            // Requires a user gesture — stay in 'unknown' so the tap prompt shows
            console.warn('Device orientation permission request failed:', error);
        }
    }, []);

    // Previously-granted iOS permission: try a silent re-request on mount.
    // If iOS insists on a gesture it rejects, and we remain in 'unknown'
    // showing the tap-to-activate prompt.
    useEffect(() =>
    {
        if (status === COMPASS_STATUS.UNKNOWN &&
            localStorage.getItem(PERMISSION_STORAGE_KEY) === 'granted') {
            requestPermission();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { heading, status, source, requestPermission };
}

export default useCompassHeading;
