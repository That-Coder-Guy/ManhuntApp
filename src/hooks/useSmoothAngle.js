import { useCallback, useEffect, useRef } from 'react';
import { smoothDamp } from '../utils/orientation';
import { getReduceMotion } from '../utils/accessibility';

// How long a turn takes to settle, in seconds: long enough to feel like a
// needle swinging, short enough to keep up while turning
const SETTLE_TIME_S = 0.3;

/**
 * Ease toward `angle` (degrees, wrapping): each frame a critically damped
 * spring moves the drawn angle toward the latest reading, the short way
 * around (350° → 10° turns +20°), and stops once settled. `paint(current)`
 * draws it (directly, so React doesn't re-render every frame); `current` is
 * continuous (it can pass 360). Returns a function that repaints at the
 * current angle, for a node that mounts later.
 */
function useSmoothAngle(angle, paint)
{
    const paintRef = useRef(paint);
    paintRef.current = paint;
    const motion = useRef({ target: null, current: null, velocity: 0, lastRaw: null, lastTime: 0, frame: 0 });

    const repaint = useCallback(() =>
    {
        const m = motion.current;
        if (m.current !== null) paintRef.current(m.current);
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
        repaint();
    }, [repaint]);

    useEffect(() =>
    {
        if (angle === null || angle === undefined) return;
        const m = motion.current;
        const raw = ((angle % 360) + 360) % 360;

        if (m.target === null) {
            // First reading: start there rather than spinning in from 0
            m.target = m.current = m.lastRaw = raw;
            repaint();
            return;
        }

        let diff = raw - m.lastRaw;
        if (diff > 180) diff -= 360;
        else if (diff < -180) diff += 360;
        m.lastRaw = raw;
        m.target += diff;

        if (getReduceMotion()) {
            m.current = m.target;
            m.velocity = 0;
            repaint();
        } else if (!m.frame) {
            m.lastTime = performance.now();
            m.frame = requestAnimationFrame(step);
        }
    }, [angle, repaint, step]);

    useEffect(() => () => cancelAnimationFrame(motion.current.frame), []);

    return repaint;
}

export default useSmoothAngle;
