import { useState, useEffect, useRef } from 'react';
import useCompassHeading, { COMPASS_STATUS } from '../hooks/useCompassHeading';
import { calculateBearing, formatDistance } from '../utils/geo';
import { bearingToCardinal } from '../utils/orientation';
import { playerFreshness } from '../utils/players';
import useNow from '../hooks/useNow';
import FixDot from './FixDot';

/**
 * Turn a 0–360 angle that wraps into a continuous one, so CSS always rotates
 * the short way (350° → 10° animates +20°, not −340°).
 */
function useUnwrappedAngle(angle)
{
    const [unwrapped, setUnwrapped] = useState(angle ?? 0);
    const previousRef = useRef(null);

    useEffect(() =>
    {
        if (angle === null || angle === undefined) return;

        let normalized = angle % 360;
        if (normalized < 0) normalized += 360;

        if (previousRef.current === null) {
            previousRef.current = normalized;
            setUnwrapped(normalized);
            return;
        }

        let diff = normalized - previousRef.current;
        if (diff > 180) diff -= 360;
        else if (diff < -180) diff += 360;

        // Ignore floating-point noise
        if (Math.abs(diff) > 0.1) {
            setUnwrapped(prev => prev + diff);
            previousRef.current = normalized;
        }
    }, [angle]);

    return unwrapped;
}

// Bezel ticks every 5°, longer every 30°; computed once
const TICKS = Array.from({ length: 72 }, (_, i) => i * 5);
const CARDINALS = [
    { label: 'N', angle: 0 },
    { label: 'E', angle: 90 },
    { label: 'S', angle: 180 },
    { label: 'W', angle: 270 },
];

function CompassArrow({ target, targetName, currentLocation, distance, onClick })
{
    const { heading, status, source, requestPermission } = useCompassHeading();
    const now = useNow();

    // Bearing to the target from true north (null when either position is missing)
    const targetBearing = calculateBearing(
        currentLocation.latitude,
        currentLocation.longitude,
        target.latitude,
        target.longitude
    );

    const isLive = status === COMPASS_STATUS.GRANTED;
    const isFallback = status === COMPASS_STATUS.UNSUPPORTED;

    // Live: the rose turns so N points at real north and the needle points at
    // the target. Without a compass the dial is drawn north-up, like a map.
    const rawNeedle = isLive
        ? (targetBearing !== null && heading !== null ? targetBearing - heading : null)
        : targetBearing;
    const rawRose = isLive ? (heading !== null ? -heading : null) : 0;

    const needleRotation = useUnwrappedAngle(rawNeedle);
    const roseRotation = useUnwrappedAngle(rawRose);
    const showNeedle = (isLive || isFallback) && rawNeedle !== null;

    const { fresh, offline, label: freshness } = playerFreshness(target, now);

    const handleCompassInteraction = (event) => {
        // Not yet asked, or refused this session: a tap asks (again)
        if (status === COMPASS_STATUS.UNKNOWN || status === COMPASS_STATUS.DENIED) {
            event?.stopPropagation?.();
            requestPermission();
            return;
        }
        onClick?.(event);
    };

    return (
        <div className="compass-arrow-container">
            {status === COMPASS_STATUS.DENIED && (
                <div className="compass-error-message compass-error-denied">
                    Compass access is off. Tap the dial to ask again, or allow motion access in your browser settings.
                </div>
            )}

            <div
                className={`compass-circle-interactive ${isLive ? 'active' : isFallback ? 'unsupported' : 'inactive'} ${onClick ? 'clickable' : ''}`}
                onClick={handleCompassInteraction}
                data-testid="compass-dial"
            >
                <svg className="compass-dial" viewBox="0 0 200 200" aria-hidden="true">
                    <defs>
                        {/* Two faces of a bevelled needle, lit from the left */}
                        <linearGradient id="needle-tip-light" x1="0" x2="1" y1="0" y2="0">
                            <stop offset="0" stopColor="#ffa05c" />
                            <stop offset="1" stopColor="#ff8a3d" />
                        </linearGradient>
                        <linearGradient id="needle-tip-dark" x1="0" x2="1" y1="0" y2="0">
                            <stop offset="0" stopColor="#e2600f" />
                            <stop offset="1" stopColor="#c4500a" />
                        </linearGradient>
                        <radialGradient id="dial-face" cx="0.5" cy="0.42" r="0.6">
                            <stop offset="0" stopColor="#161a24" />
                            <stop offset="1" stopColor="#0d1017" />
                        </radialGradient>
                    </defs>

                    {/* Bezel */}
                    <circle className="compass-bezel" cx="100" cy="100" r="98" />

                    {/* Rose: ticks and cardinal letters, turning with the phone */}
                    <g className="compass-rose" style={{ transform: `rotate(${roseRotation}deg)` }}>
                        {TICKS.map((angle) => {
                            const major = angle % 30 === 0;
                            return (
                                <line
                                    key={angle}
                                    className={major ? 'compass-tick compass-tick--major' : 'compass-tick'}
                                    x1="100" x2="100"
                                    y1="6" y2={major ? 16 : 11}
                                    transform={`rotate(${angle} 100 100)`}
                                />
                            );
                        })}
                        {CARDINALS.map(({ label, angle }) => (
                            <text
                                key={label}
                                className={label === 'N' ? 'compass-cardinal compass-cardinal--north' : 'compass-cardinal'}
                                x="100" y="31"
                                transform={`rotate(${angle} 100 100)`}
                            >
                                {label}
                            </text>
                        ))}
                    </g>

                    {/* Capsule the needle swings in */}
                    <circle className="compass-face" cx="100" cy="100" r="62" fill="url(#dial-face)" />

                    {showNeedle && (
                        <g className="compass-arrow" style={{ transform: `rotate(${needleRotation}deg)` }}>
                            <polygon points="100,44 91,100 100,100" fill="url(#needle-tip-light)" />
                            <polygon points="100,44 109,100 100,100" fill="url(#needle-tip-dark)" />
                            <polygon className="compass-needle-tail compass-needle-tail--light" points="100,156 91,100 100,100" />
                            <polygon className="compass-needle-tail compass-needle-tail--dark" points="100,156 109,100 100,100" />
                            <circle className="compass-hub" cx="100" cy="100" r="7" />
                            <circle className="compass-hub-pin" cx="100" cy="100" r="2.5" />
                        </g>
                    )}
                </svg>

                {/* iOS asks for motion access on a tap */}
                {status === COMPASS_STATUS.UNKNOWN && (
                    <span className="compass-activation-hint">Enable compass</span>
                )}
            </div>

            {/* Readout under the dial, always the same lines so nothing shifts */}
            <div className="compass-readout">
                <div className="compass-player-name">
                    <FixDot fresh={fresh} offline={offline} />
                    <span className="compass-player-name-text">{targetName}</span>
                </div>
                <div className="compass-distance-display">{formatDistance(distance)}</div>
                <div className="compass-freshness">
                    {isFallback && targetBearing !== null
                        ? <span className="compass-cardinal-direction">Head {bearingToCardinal(targetBearing)} · </span>
                        : null}
                    {freshness}
                </div>
            </div>

            {/* Reserved slot, so the hints appearing never move the dial */}
            <div className="compass-calibration-hint">
                {isLive && source !== 'webkit' && 'Needle off? Move your phone in a figure 8 to calibrate'}
                {isFallback && (
                    <span className="compass-cardinal-fallback">No compass on this phone, so north is up</span>
                )}
            </div>
        </div>
    );
}

export default CompassArrow;
