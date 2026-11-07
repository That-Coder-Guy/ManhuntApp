import { useEffect, useState } from 'react';

/**
 * Re-render every `intervalMs` so relative times ("12s ago") stay current.
 * Pass `enabled = false` to stop ticking while nothing time-based is shown.
 */
function useNow(intervalMs = 1000, enabled = true)
{
    const [now, setNow] = useState(() => Date.now());

    useEffect(() =>
    {
        if (!enabled) return undefined;
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs, enabled]);

    return now;
}

export default useNow;
