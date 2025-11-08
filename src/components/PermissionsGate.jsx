import { useEffect, useMemo, useState } from 'react';

function PermissionsGate({
  onComplete,
  requestWakeLock,
  isWakeLockSupported,
  isWakeLockActive,
}) {
  const isBrowser = typeof window !== 'undefined';
  const isLocationSupported = isBrowser && 'geolocation' in navigator;

  const [locationStatus, setLocationStatus] = useState('prompt');
  const [wakeLockStatus, setWakeLockStatus] = useState(
    isWakeLockSupported ? 'prompt' : 'unsupported'
  );
  const [isContinuing, setIsContinuing] = useState(false);

  const statusLabels = useMemo(
    () => ({
      prompt: 'Pending',
      requesting: 'Requesting…',
      granted: 'Granted',
      denied: 'Denied',
      unsupported: 'Unsupported',
    }),
    []
  );

  useEffect(() => {
    if (!isBrowser) {
      return;
    }

    let geoPermissionStatus;
    let cancelled = false;

    function applyGeolocationState(state) {
      if (cancelled) return;

      if (state === 'granted') {
        setLocationStatus('granted');
      } else if (state === 'denied') {
        setLocationStatus('denied');
      } else {
        setLocationStatus('prompt');
      }
    }

    if (isLocationSupported && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (cancelled) return;
          geoPermissionStatus = status;
          applyGeolocationState(status.state);
          status.onchange = () => applyGeolocationState(status.state);
        })
        .catch(() => {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              () => applyGeolocationState('granted'),
              () => applyGeolocationState('denied')
            );
          }
        });
    } else if (!isLocationSupported) {
      setLocationStatus('unsupported');
    }

    return () => {
      cancelled = true;
      if (geoPermissionStatus) {
        geoPermissionStatus.onchange = null;
      }
    };
  }, [isBrowser, isLocationSupported]);

  useEffect(() => {
    if (!isWakeLockSupported) {
      setWakeLockStatus('unsupported');
    }
  }, [isWakeLockSupported]);

  useEffect(() => {
    if (!isWakeLockSupported) {
      return;
    }

    if (isWakeLockActive) {
      setWakeLockStatus('granted');
    } else if (wakeLockStatus === 'granted') {
      setWakeLockStatus('prompt');
    }
  }, [isWakeLockSupported, isWakeLockActive, wakeLockStatus]);

  const locationGranted = locationStatus === 'granted';
  const wakeLockGranted = !isWakeLockSupported || wakeLockStatus === 'granted';

  const canContinue = locationGranted && wakeLockGranted;

  const handleLocationToggle = () => {
    if (!isLocationSupported) {
      setLocationStatus('unsupported');
      return;
    }

    if (locationStatus === 'requesting' || locationStatus === 'granted') {
      return;
    }

    setLocationStatus('requesting');

    navigator.geolocation.getCurrentPosition(
      () => {
        setLocationStatus('granted');
      },
      () => {
        setLocationStatus('denied');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 10_000,
      }
    );
  };

  const handleWakeLockToggle = async () => {
    if (!isWakeLockSupported) {
      setWakeLockStatus('unsupported');
      return;
    }

    if (wakeLockStatus === 'requesting' || wakeLockStatus === 'granted') {
      return;
    }

    setWakeLockStatus('requesting');

    try {
      await requestWakeLock();
      setWakeLockStatus('granted');
    } catch (error) {
      console.error('[Permissions] Wake lock request failed:', error);
      setWakeLockStatus('denied');
    }
  };

  const handleContinue = () => {
    if (!canContinue || isContinuing) {
      return;
    }

    setIsContinuing(true);
    onComplete();
  };

  return (
    <div className="permissions-overlay" role="dialog" aria-modal="true">
      <div className="permissions-card">
        <h2>Enable Permissions</h2>

        <div className="permissions-list">
          <div className="permission-item">
            <span className="permission-name">Location</span>
            <span className={`permission-status permission-status-${locationStatus}`}>
              {statusLabels[locationStatus] || locationStatus}
            </span>
            <button
              type="button"
              className={`permission-toggle ${locationGranted ? 'toggle-on' : ''}`}
              onClick={handleLocationToggle}
              disabled={
                locationStatus === 'requesting' ||
                locationStatus === 'unsupported'
              }
            >
              <span className="toggle-slider" />
            </button>
          </div>

          <div className="permission-item">
            <span className="permission-name">Wake Lock</span>
            <span className={`permission-status permission-status-${wakeLockStatus}`}>
              {statusLabels[wakeLockStatus] || wakeLockStatus}
            </span>
            <button
              type="button"
              className={`permission-toggle ${wakeLockGranted ? 'toggle-on' : ''}`}
              onClick={handleWakeLockToggle}
              disabled={
                wakeLockStatus === 'requesting' ||
                wakeLockStatus === 'unsupported' ||
                !isWakeLockSupported
              }
            >
              <span className="toggle-slider" />
            </button>
          </div>
        </div>

        <button
          type="button"
          className="permissions-continue-button"
          onClick={handleContinue}
          disabled={!canContinue || isContinuing}
        >
          {canContinue ? 'Continue' : 'Waiting for permissions'}
        </button>
      </div>
    </div>
  );
}

export default PermissionsGate;

