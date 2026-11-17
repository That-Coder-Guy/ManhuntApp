import { useEffect, useRef, useState } from 'react';

const NO_FIX = { latitude: null, longitude: null };

/**
 * Watch the device position while `enabled` (the first watch is what makes
 * the browser ask for permission). Every fix updates local state (so the
 * player's own distances work offline) and is handed to `onFix`.
 * `gpsError` is true while the browser reports no usable position; the
 * watch keeps running and clears it on the next fix. `gpsDenied` says the
 * reason is that location isn't allowed.
 */
function useGeolocation(enabled, onFix)
{
    const [location, setLocation] = useState(NO_FIX);
    const [gpsError, setGpsError] = useState(false);
    const [gpsDenied, setGpsDenied] = useState(false);

    // The latest callback, without restarting the watch when it changes
    const onFixRef = useRef(onFix);
    onFixRef.current = onFix;

    useEffect(() =>
    {
        if (!enabled) return undefined;
        if (!navigator.geolocation)
        {
            setGpsError(true);
            return undefined;
        }

        const watchId = navigator.geolocation.watchPosition(
            ({ coords: { latitude, longitude } }) =>
            {
                setGpsError(false);
                setGpsDenied(false);
                setLocation({ latitude, longitude });
                onFixRef.current?.(latitude, longitude);
            },
            (error) =>
            {
                console.warn('Geolocation error:', error);
                setGpsError(true);
                setGpsDenied(error.code === error.PERMISSION_DENIED);
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );

        return () => navigator.geolocation.clearWatch(watchId);
    }, [enabled]);

    return { location, gpsError, gpsDenied };
}

export default useGeolocation;
