import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Requests a screen wake lock while `enabled` is true and supported by the browser.
 * Releases the lock automatically when the component unmounts or when the page
 * becomes hidden.
 */
function useWakeLock(enabled = true) {
  const wakeLockRef = useRef(null);
  const alertShownRef = useRef(false);
  const hasUserInitiatedRef = useRef(false);
  const isCancelledRef = useRef(false);
  const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [isActive, setIsActive] = useState(false);

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current) {
      return;
    }

    try {
      await wakeLockRef.current.release();
    } catch (error) {
      console.warn('[WakeLock] Failed to release screen wake lock:', error);
    } finally {
      wakeLockRef.current = null;
      setIsActive(false);
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!enabled) {
      throw new Error('Wake Lock request ignored because it is currently disabled.');
    }

    if (!isSupported) {
      throw new Error('Screen Wake Lock API is not supported on this device.');
    }

    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }

      const lock = await navigator.wakeLock.request('screen');
      wakeLockRef.current = lock;
      hasUserInitiatedRef.current = true;
      alertShownRef.current = false;
      setIsActive(true);

      lock.addEventListener('release', () => {
        wakeLockRef.current = null;
        setIsActive(false);

        if (
          !isCancelledRef.current &&
          enabled &&
          document.visibilityState === 'visible' &&
          hasUserInitiatedRef.current
        ) {
          requestWakeLock().catch(() => {
            /* noop - error already handled in requestWakeLock */
          });
        }
      });

      return lock;
    } catch (error) {
      wakeLockRef.current = null;
      setIsActive(false);
      console.warn('[WakeLock] Failed to acquire screen wake lock:', error);
      if (
        !alertShownRef.current &&
        !isCancelledRef.current &&
        typeof window !== 'undefined' &&
        typeof window.alert === 'function'
      ) {
        alertShownRef.current = true;
        window.alert('Unable to keep the screen awake. Please ensure your device allows screen wake locks and try again.');
      }
      throw error;
    }
  }, [enabled, isSupported]);

  useEffect(() => {
    isCancelledRef.current = false;

    if (!enabled) {
      releaseWakeLock().catch(() => {
        /* ignore */
      });
      return () => {
        isCancelledRef.current = true;
        releaseWakeLock().catch(() => {
          /* ignore */
        });
      };
    }

    function handleVisibilityChange() {
      if (!enabled) {
        return;
      }

      if (document.visibilityState === 'visible') {
        if (!wakeLockRef.current && hasUserInitiatedRef.current) {
          requestWakeLock().catch(() => {
            /* error already handled */
          });
        }
      } else {
        releaseWakeLock().catch(() => {
          /* ignore */
        });
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isCancelledRef.current = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock().catch(() => {
        /* ignore */
      });
    };
  }, [enabled, releaseWakeLock, requestWakeLock]);

  return {
    isSupported,
    isActive,
    requestWakeLock,
    releaseWakeLock,
  };
}

export default useWakeLock;
