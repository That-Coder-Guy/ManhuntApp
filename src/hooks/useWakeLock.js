import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps the screen on once the player asks for it (`requestWakeLock`, called
 * from a tap), for as long as `enabled` is true. Browsers drop the lock
 * whenever the page is hidden, so it is taken back when the page returns.
 * Failures reject the request; the caller decides how to show them.
 */
function useWakeLock(enabled = true)
{
    const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
    const [isActive, setIsActive] = useState(false);

    const lockRef = useRef(null);
    const pendingRef = useRef(null); // in-flight request, so taps can't stack locks
    const wantedRef = useRef(false); // the player turned it on

    const acquire = useCallback(() =>
    {
        if (lockRef.current) return Promise.resolve(lockRef.current);
        if (pendingRef.current) return pendingRef.current;

        pendingRef.current = navigator.wakeLock.request('screen')
            .then((lock) =>
            {
                lockRef.current = lock;
                setIsActive(true);
                lock.addEventListener('release', () =>
                {
                    if (lockRef.current !== lock) return;
                    lockRef.current = null;
                    setIsActive(false);
                });
                return lock;
            })
            .finally(() => { pendingRef.current = null; });

        return pendingRef.current;
    }, []);

    const requestWakeLock = useCallback(() =>
    {
        if (!isSupported) return Promise.reject(new Error('Screen Wake Lock is not supported on this device'));
        if (!enabled) return Promise.reject(new Error('Wake lock is not available right now'));
        wantedRef.current = true;
        return acquire();
    }, [isSupported, enabled, acquire]);

    useEffect(() =>
    {
        if (!enabled || !isSupported) return undefined;

        const handleVisibility = () =>
        {
            if (document.visibilityState === 'visible' && wantedRef.current)
            {
                acquire().catch((error) => console.warn('[WakeLock] Could not re-acquire:', error));
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () =>
        {
            document.removeEventListener('visibilitychange', handleVisibility);
            wantedRef.current = false;
            const lock = lockRef.current;
            lockRef.current = null;
            setIsActive(false);
            lock?.release().catch(() => { /* already released */ });
        };
    }, [enabled, isSupported, acquire]);

    return { isSupported, isActive, requestWakeLock };
}

export default useWakeLock;
