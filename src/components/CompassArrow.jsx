import { useState, useEffect, useRef, useMemo } from 'react';

function CompassArrow({ targetLatitude, targetLongitude, currentLocation, targetName, distance, onClick })
{
    const [deviceHeading, setDeviceHeading] = useState(0);
    const [compassPermission, setCompassPermission] = useState('unknown'); // 'unknown', 'granted', 'denied', 'unsupported'
    const [accumulatedRotation, setAccumulatedRotation] = useState(0);
    const previousRotationRef = useRef(null);
    const PERMISSION_STORAGE_KEY = 'manhunt_compass_permission';

    const deviceInfo = useMemo(() => {
        if (typeof navigator === 'undefined') {
            return { isIOS: false, isAndroid: false };
        }
        const ua = navigator.userAgent || '';
        const platform = navigator.platform || '';
        const isIOS = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isAndroid = /Android/.test(ua);
        return { isIOS, isAndroid };
    }, []);

    // Initialize permission state from storage / platform defaults
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const savedPermission = localStorage.getItem(PERMISSION_STORAGE_KEY);
        if (savedPermission === 'granted') {
            setCompassPermission('granted');
            return;
        }
        if (savedPermission === 'denied') {
            setCompassPermission('denied');
            return;
        }

        if (deviceInfo.isAndroid) {
            setCompassPermission('granted');
            localStorage.setItem(PERMISSION_STORAGE_KEY, 'granted');
        } else if (!deviceInfo.isIOS) {
            setCompassPermission('unsupported');
        } else {
            setCompassPermission('unknown');
        }
    }, [deviceInfo]);

    // Persist permission selections
    useEffect(() => {
        if (typeof window === 'undefined') return;

        if (compassPermission === 'granted') {
            localStorage.setItem(PERMISSION_STORAGE_KEY, 'granted');
        } else if (compassPermission === 'denied') {
            localStorage.setItem(PERMISSION_STORAGE_KEY, 'denied');
        }
    }, [compassPermission]);

    // Attach orientation listeners when permission granted
    useEffect(() => {
        if (compassPermission !== 'granted' || typeof window === 'undefined') {
            return undefined;
        }

        const handleOrientation = (event) => {
            if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
                setDeviceHeading(event.webkitCompassHeading);
            } else if (event.alpha !== null) {
                setDeviceHeading(event.alpha);
            }
        };

        const handleOrientationAbsolute = (event) => {
            if (event.alpha !== null) {
                setDeviceHeading(event.alpha);
            }
        };

        const attachListeners = () => {
            if (window.DeviceOrientationEvent) {
                window.addEventListener('deviceorientation', handleOrientation, true);
                window.addEventListener('deviceorientationabsolute', handleOrientationAbsolute, true);
            }
        };

        const detachListeners = () => {
            window.removeEventListener('deviceorientation', handleOrientation, true);
            window.removeEventListener('deviceorientationabsolute', handleOrientationAbsolute, true);
        };

        attachListeners();

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                detachListeners();
                attachListeners();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            detachListeners();
        };
    }, [compassPermission]);

    // Calculate bearing from current location to target
    function calculateBearing(lat1, lon1, lat2, lon2)
    {
        if (!lat1 || !lon1 || !lat2 || !lon2) return null;

        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) -
                Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        
        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        bearing = (bearing + 360) % 360; // Normalize to 0-360

        return bearing;
    }

    // Format distance for display
    function formatDistance(distance)
    {
        if (distance === null || distance === undefined) return 'Unknown';
        if (distance < 1000) return `${Math.round(distance)}m`;
        return `${(distance / 1000).toFixed(2)}km`;
    }

    // Get bearing to target
    const targetBearing = targetLatitude && targetLongitude && currentLocation.latitude && currentLocation.longitude
        ? calculateBearing(
            currentLocation.latitude,
            currentLocation.longitude,
            targetLatitude,
            targetLongitude
        )
        : null;

    // Calculate arrow rotation (target bearing - device heading)
    // Use accumulated rotation to prevent CSS from seeing large jumps
    const rawRotation = targetBearing !== null ? targetBearing - deviceHeading : 0;
    
    // Calculate the shortest angular difference between new and old rotation
    useEffect(() => {
        // Normalize raw rotation to 0-360
        let normalizedRaw = rawRotation % 360;
        if (normalizedRaw < 0) normalizedRaw += 360;
        
        // First time initialization
        if (previousRotationRef.current === null) {
            previousRotationRef.current = normalizedRaw;
            setAccumulatedRotation(normalizedRaw);
            return;
        }
        
        // Calculate difference from previous rotation
        let diff = normalizedRaw - previousRotationRef.current;
        
        // Normalize difference to -180 to +180 (shortest path)
        if (diff > 180) {
            diff -= 360;
        } else if (diff < -180) {
            diff += 360;
        }
        
        // Only update if there's a meaningful change (avoid floating point noise)
        if (Math.abs(diff) > 0.1) {
            setAccumulatedRotation(prev => prev + diff);
            previousRotationRef.current = normalizedRaw;
        }
    }, [rawRotation]);

    const arrowRotation = accumulatedRotation;

    const handleCompassInteraction = (event) => {
        if (compassPermission === 'unknown' && deviceInfo.isIOS) {
            if (event?.stopPropagation) {
                event.stopPropagation();
            }
            requestCompassPermission();
            return;
        }

        if (typeof onClick === 'function') {
            onClick(event);
        }
    };

    async function requestCompassPermission()
    {
        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permissionState = await DeviceOrientationEvent.requestPermission();
                if (permissionState === 'granted') {
                    setCompassPermission('granted');
                } else {
                    setCompassPermission('denied');
                }
            } catch (error) {
                console.error('Error requesting device orientation permission:', error);
                setCompassPermission('denied');
            }
        }
    }

    return (
        <div className="compass-arrow-container">
            {/* Show message if permission denied */}
            {compassPermission === 'denied' && (
                <div className="compass-error-message compass-error-denied">
                    Compass access denied. Please enable in device settings.
                </div>
            )}

            {/* Compass Circle with Arrow */}
            <div 
                className={`compass-circle-interactive ${
                    compassPermission === 'granted' ? 'active' : compassPermission === 'unsupported' ? 'unsupported' : 'inactive'
                } ${onClick ? 'clickable' : ''}`}
                onClick={handleCompassInteraction}
            >
                {/* Player name indicator */}
                <div className={`compass-player-name ${
                    compassPermission === 'granted' ? 'visible' : 'hidden'
                }`}>
                    {targetName}
                </div>

                {/* Unsupported message */}
                {compassPermission === 'unsupported' && (
                    <div className="compass-unsupported-hint">
                        Orientation tracking is not supported on this device.
                    </div>
                )}

                {/* Pending permission hint */}
                {compassPermission === 'unknown' && deviceInfo.isIOS && (
                    <div className="compass-activation-hint">
                        Tap to activate compass
                    </div>
                )}
                
                {/* Direction Arrow */}
                {compassPermission === 'granted' && (
                    <div 
                        className="compass-arrow"
                        style={{ transform: `rotate(${arrowRotation}deg)` }}
                    >
                        ↑
                    </div>
                )}

                {/* Distance display in center */}
                {compassPermission === 'granted' && (
                    <div className="compass-distance-display">
                        {formatDistance(distance)}
                    </div>
                )}
            </div>
        </div>
    );
}

export default CompassArrow;

