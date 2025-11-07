import { useState, useEffect, useRef } from 'react';

function CompassArrow({ targetLatitude, targetLongitude, currentLocation, targetName, distance, onClick })
{
    const [deviceHeading, setDeviceHeading] = useState(0);
    const [compassPermission, setCompassPermission] = useState('unknown'); // 'unknown', 'granted', 'denied', 'unsupported'
    const [accumulatedRotation, setAccumulatedRotation] = useState(0);
    const previousRotationRef = useRef(null);
    const PERMISSION_STORAGE_KEY = 'manhunt_compass_permission';

    // Check for saved permission state on mount
    useEffect(() => {
        const savedPermission = localStorage.getItem(PERMISSION_STORAGE_KEY);
        if (savedPermission === 'granted') {
            // Permission was previously granted, set up listeners immediately
            setCompassPermission('granted');
        } else if (savedPermission === 'denied') {
            // Permission was previously denied, don't ask again
            setCompassPermission('denied');
        }
    }, []);

    // Get device compass heading
    useEffect(() => {
        let permissionGranted = false;

        function handleOrientation(event) {
            // iOS devices: use webkitCompassHeading (true heading relative to North)
            if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
                // webkitCompassHeading gives degrees from North (0-360)
                setDeviceHeading(event.webkitCompassHeading);
            }
            // Android/other devices: use alpha (0-360, where 0 is North)
            else if (event.alpha !== null) {
                setDeviceHeading(event.alpha);
            }
        }

        function handleOrientationAbsolute(event) {
            // Absolute orientation gives true heading on Android devices
            // Alpha is 0-360 where 0 = North, increases clockwise
            if (event.alpha !== null) {
                setDeviceHeading(event.alpha);
            }
        }

        // Detect iOS devices
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        
        // Detect Android devices
        const isAndroid = /Android/.test(navigator.userAgent);

        // Only proceed if device is iOS or Android
        if (isIOS || isAndroid) {
            // Check if permission was previously granted
            const savedPermission = localStorage.getItem(PERMISSION_STORAGE_KEY);
            
            // iOS 13+ requires permission
            if (typeof DeviceOrientationEvent !== 'undefined' && 
                typeof DeviceOrientationEvent.requestPermission === 'function') {
                // If permission was previously granted, set up listeners immediately
                if (savedPermission === 'granted') {
                    permissionGranted = true;
                    setCompassPermission('granted');
                    window.addEventListener('deviceorientation', handleOrientation, true);
                } else {
                    // Waiting for user to grant permission
                    setCompassPermission('unknown');
                }
            } else if (isAndroid) {
                // Android devices - no permission needed, directly set up listeners
                permissionGranted = true;
                setCompassPermission('granted');
                // Save to localStorage so we remember it
                localStorage.setItem(PERMISSION_STORAGE_KEY, 'granted');
                // Try absolute orientation first (more accurate for compass)
                if (window.DeviceOrientationEvent) {
                    window.addEventListener('deviceorientationabsolute', handleOrientationAbsolute, true);
                }
                // Fallback to regular orientation
                window.addEventListener('deviceorientation', handleOrientation, true);
            }
        } else {
            setCompassPermission('unsupported');
        }

        return () => {
            if (permissionGranted) {
                window.removeEventListener('deviceorientation', handleOrientation, true);
                window.removeEventListener('deviceorientationabsolute', handleOrientationAbsolute, true);
            }
        };
    }, []);

    // Function to request iOS compass permission (must be called from user gesture)
    async function requestCompassPermission()
    {
        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permissionState = await DeviceOrientationEvent.requestPermission();
                if (permissionState === 'granted') {
                    setCompassPermission('granted');
                    
                    // Save permission to localStorage so we remember it
                    localStorage.setItem(PERMISSION_STORAGE_KEY, 'granted');
                    
                    // Set up event listeners
                    function handleOrientation(event) {
                        if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
                            setDeviceHeading(event.webkitCompassHeading);
                        } else if (event.alpha !== null) {
                            setDeviceHeading(event.alpha);
                        }
                    }
                    
                    window.addEventListener('deviceorientation', handleOrientation, true);
                } else {
                    setCompassPermission('denied');
                    // Save denied state so we don't ask again
                    localStorage.setItem(PERMISSION_STORAGE_KEY, 'denied');
                }
            } catch (error) {
                console.error('Error requesting device orientation permission:', error);
                setCompassPermission('denied');
                localStorage.setItem(PERMISSION_STORAGE_KEY, 'denied');
            }
        }
    }

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

    return (
        <div className="compass-arrow-container">
            {/* Show message if permission denied */}
            {compassPermission === 'denied' && (
                <div className="compass-error-message compass-error-denied">
                    Compass access denied. Please enable in device settings.
                </div>
            )}

            {/* Show message if unsupported device */}
            {compassPermission === 'unsupported' && (
                <div className="compass-error-message compass-error-unsupported">
                    Compass not available on this device. Arrow shows direction from North.
                </div>
            )}
            
            {/* Compass Circle with Arrow */}
            <div 
                className={`compass-circle-interactive ${
                    compassPermission === 'granted' || compassPermission === 'unsupported' ? 'active' : 'inactive'
                } ${onClick ? 'clickable' : ''}`}
                onClick={onClick}
            >
                {/* Player name indicator */}
                <div className={`compass-player-name ${
                    compassPermission === 'granted' || compassPermission === 'unsupported' ? 'visible' : 'hidden'
                }`}>
                    {targetName}
                </div>
                
                {/* Permission request button in center */}
                {compassPermission === 'unknown' && (
                    <button
                        className="compass-permission-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            requestCompassPermission();
                        }}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            e.currentTarget.style.transform = 'scale(0.95)';
                        }}
                        onMouseUp={(e) => {
                            e.stopPropagation();
                            e.currentTarget.style.transform = 'scale(1)';
                        }}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchEnd={(e) => e.stopPropagation()}
                    >
                        Enable
                    </button>
                )}
                
                {/* Direction Arrow */}
                {(compassPermission === 'granted' || compassPermission === 'unsupported') && (
                    <div 
                        className="compass-arrow"
                        style={{ transform: `rotate(${arrowRotation}deg)` }}
                    >
                        ↑
                    </div>
                )}

                {/* Distance display in center */}
                {(compassPermission === 'granted' || compassPermission === 'unsupported') && (
                    <div className="compass-distance-display">
                        {formatDistance(distance)}
                    </div>
                )}
            </div>
        </div>
    );
}

export default CompassArrow;

