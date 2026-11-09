import { useCallback, useEffect, useRef } from 'react';
import useCompassHeading, { COMPASS_STATUS } from '../hooks/useCompassHeading';
import { calculateBearing, formatDistance } from '../utils/geo';
import { bearingToCardinal, smoothDamp } from '../utils/orientation';
import { playerFreshness } from '../utils/players';
import useNow from '../hooks/useNow';
import FixDot from './FixDot';

// How long the dial takes to settle on a new heading, in seconds: long
// enough to feel like a needle swinging, short enough to keep up while turning
const SETTLE_TIME_S = 0.3;

function prefersReducedMotion()
{
    return typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Rotate an SVG group smoothly toward `angle` (0–360, wrapping). Each frame a
 * critically damped spring eases the drawn angle toward the latest reading,
 * the short way around (350° → 10° turns +20°), and stops once settled. It
 * writes the transform directly, so React doesn't re-render every frame.
 * Returns a ref callback for the group.
 */
function useSmoothRotation(angle)
{
    const nodeRef = useRef(null);
    // target and current are continuous (unwrapped) angles
    const motion = useRef({ target: null, current: null, velocity: 0, lastRaw: null, lastTime: 0, frame: 0 });

    const paint = useCallback(() =>
    {
        const m = motion.current;
        if (nodeRef.current && m.current !== null) {
            nodeRef.current.style.transform = `rotate(${m.current}deg)`;
        }
    }, []);

    const step = useCallback((time) =>
    {
        const m = motion.current;
        const dt = Math.min((time - m.lastTime) / 1000, 0.1); // a stalled tab mustn't jump
        m.lastTime = time;
        [m.current, m.velocity] = smoothDamp(m.current, m.target, m.velocity, SETTLE_TIME_S, dt);
        if (Math.abs(m.target - m.current) < 0.05 && Math.abs(m.velocity) < 0.05) {
            m.current = m.target;
            m.velocity = 0;
            m.frame = 0;
        } else {
            m.frame = requestAnimationFrame(step);
        }
        paint();
    }, [paint]);

    useEffect(() =>
    {
        if (angle === null || angle === undefined) return;
        const m = motion.current;
        const raw = ((angle % 360) + 360) % 360;

        if (m.target === null) {
            // First reading: start there rather than spinning in from 0
            m.target = m.current = m.lastRaw = raw;
            paint();
            return;
        }

        let diff = raw - m.lastRaw;
        if (diff > 180) diff -= 360;
        else if (diff < -180) diff += 360;
        m.lastRaw = raw;
        m.target += diff;

        if (prefersReducedMotion()) {
            m.current = m.target;
            m.velocity = 0;
            paint();
        } else if (!m.frame) {
            m.lastTime = performance.now();
            m.frame = requestAnimationFrame(step);
        }
    }, [angle, paint, step]);

    useEffect(() => () => cancelAnimationFrame(motion.current.frame), []);

    // The needle mounts later than the rose; draw it in place straight away
    return useCallback((node) =>
    {
        nodeRef.current = node;
        paint();
    }, [paint]);
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

    const needleRef = useSmoothRotation(rawNeedle);
    const roseRef = useSmoothRotation(rawRose);
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
                    <g className="compass-rose" ref={roseRef}>
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
                        <g className="compass-arrow" ref={needleRef}>
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
