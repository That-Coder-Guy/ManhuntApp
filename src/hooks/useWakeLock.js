import { useEffect } from 'react';

/**
 * Keeps the screen on while `active` (during a game, if the player hasn't
 * turned it off in Settings). Wake locks need no permission. Browsers drop
 * the lock whenever the page is hidden, and some only grant it after a tap,
 * so it is taken again when the page returns and on the next tap.
 */
function useWakeLock(active)
{
    useEffect(() =>
    {
        if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return undefined;

        let lock = null;
        let pending = false;
        let stopped = false;

        const acquire = () =>
        {
            if (lock || pending || stopped || document.visibilityState !== 'visible') return;
            pending = true;
            navigator.wakeLock.request('screen')
                .then((newLock) =>
                {
                    if (stopped) return newLock.release();
                    lock = newLock;
                    newLock.addEventListener('release', () => { if (lock === newLock) lock = null; });
                })
                .catch(() => { /* not now (no tap yet, low battery): the next tap or return tries again */ })
                .finally(() => { pending = false; });
        };

        acquire();
        document.addEventListener('visibilitychange', acquire);
        document.addEventListener('pointerdown', acquire);

        return () =>
        {
            stopped = true;
            document.removeEventListener('visibilitychange', acquire);
            document.removeEventListener('pointerdown', acquire);
            lock?.release().catch(() => { /* already released */ });
            lock = null;
        };
    }, [active]);
}

export default useWakeLock;
