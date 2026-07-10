import { useState, useEffect, useRef } from 'react';
import useCompassHeading, { COMPASS_STATUS } from '../hooks/useCompassHeading';
import { calculateBearing, formatDistance } from '../utils/geo';
import { bearingToCardinal } from '../utils/orientation';
import { getTimeAgo, isStale } from '../utils/time';

function CompassArrow({ targetLatitude, targetLongitude, currentLocation, targetName, distance, locationLastUpdated, isDisconnected, onClick })
{
    const { heading, status, source, requestPermission } = useCompassHeading();
    const [accumulatedRotation, setAccumulatedRotation] = useState(0);
    const previousRotationRef = useRef(null);

    // Get bearing to target (null when either position is missing)
    const targetBearing = calculateBearing(
        currentLocation.latitude,
        currentLocation.longitude,
        targetLatitude,
        targetLongitude
    );

    // Tick every second so the freshness label stays current
    const [, setTick] = useState(0);
    useEffect(() =>
    {
        const intervalId = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(intervalId);
    }, []);

    const targetIsStale = isDisconnected || isStale(locationLastUpdated);

    // Calculate arrow rotation (target bearing - device heading).
    // Use accumulated rotation to prevent CSS from seeing large jumps.
    const rawRotation = (targetBearing !== null && heading !== null)
        ? targetBearing - heading
        : null;

    // Calculate the shortest angular difference between new and old rotation
    useEffect(() => {
        if (rawRotation === null) return;

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
        if (status === COMPASS_STATUS.UNKNOWN) {
            if (event?.stopPropagation) {
                event.stopPropagation();
            }
            requestPermission();
            return;
        }

        if (typeof onClick === 'function') {
            onClick(event);
        }
    };

    return (
        <div className="compass-arrow-container">
            {/* Show message if permission denied */}
            {status === COMPASS_STATUS.DENIED && (
                <div className="compass-error-message compass-error-denied">
                    Compass access denied. Please enable in device settings.
                </div>
            )}

            {/* Compass Circle with Arrow */}
            <div
                className={`compass-circle-interactive ${
                    status === COMPASS_STATUS.GRANTED ? 'active' : status === COMPASS_STATUS.UNSUPPORTED ? 'unsupported' : 'inactive'
                } ${onClick ? 'clickable' : ''}`}
                onClick={handleCompassInteraction}
            >
                {/* Player name indicator */}
                <div className={`compass-player-name ${
                    status === COMPASS_STATUS.GRANTED || status === COMPASS_STATUS.UNSUPPORTED ? 'visible' : 'hidden'
                }`}>
                    {targetName}
                </div>

                {/* No compass on this device: fall back to cardinal direction + distance */}
                {status === COMPASS_STATUS.UNSUPPORTED && (
                    <div className="compass-cardinal-fallback">
                        <div className="compass-cardinal-direction">
                            {targetBearing !== null ? `Head ${bearingToCardinal(targetBearing)}` : '—'}
                        </div>
                        <div className="compass-cardinal-distance">
                            {formatDistance(distance)}
                        </div>
                        <div className="compass-unsupported-hint">
                            No compass available — direction is relative to north
                        </div>
                    </div>
                )}

                {/* Pending permission (iOS) */}
                {status === COMPASS_STATUS.UNKNOWN && (
                    <div className="compass-activation-hint">
                        Tap to activate compass
                    </div>
                )}

                {/* Direction Arrow */}
                {status === COMPASS_STATUS.GRANTED && (
                    <div
                        className="compass-arrow"
                        style={{ transform: `rotate(${arrowRotation}deg)` }}
                    >
                        ↑
                    </div>
                )}

                {/* Distance display in center */}
                {status === COMPASS_STATUS.GRANTED && (
                    <div className="compass-distance-display">
                        {formatDistance(distance)}
                    </div>
                )}

                {/* Freshness warning when the target's position is stale */}
                {(status === COMPASS_STATUS.GRANTED || status === COMPASS_STATUS.UNSUPPORTED) && targetIsStale && (
                    <div className="compass-freshness">
                        {isDisconnected ? 'offline · ' : ''}
                        {locationLastUpdated
                            ? `updated ${getTimeAgo(locationLastUpdated)}`
                            : 'no location yet'}
                    </div>
                )}
            </div>

            {/* Android magnetometers routinely need a calibration wave */}
            {status === COMPASS_STATUS.GRANTED && source !== 'webkit' && (
                <div className="compass-calibration-hint">
                    Arrow off? Wave your phone in a figure-8 to calibrate.
                </div>
            )}
        </div>
    );
}

export default CompassArrow;
