import useNow from '../hooks/useNow';
import { formatDistance, formatHiderDistance } from '../utils/geo';
import { playerFreshness } from '../utils/players';
import FixDot from './FixDot';

/**
 * The lines under the compass dial or the tracking map: who, how far, and how
 * fresh their position is, with "Head NE" first when a direction in words
 * helps. A hider the server only places to within some distance (slow or
 * still) reads "≈ 120 m" and "±100 m": the arrow and the distance are to the
 * middle of the area they are in. Always the same lines, so nothing shifts
 * as values change.
 */
function TargetReadout({ target, name, distance, direction = null })
{
    const now = useNow();
    const { fresh, offline, jammed, label: freshness } = playerFreshness(target, now);
    const vague = target.uncertainty_m > 0;

    return (
        <div className="compass-readout" data-testid="target-readout">
            <div className="compass-player-name">
                <FixDot fresh={fresh} offline={offline} />
                <span className="compass-player-name-text">{name}</span>
            </div>
            <div className="compass-distance-display" data-testid="target-readout-distance">{formatHiderDistance(distance, target.uncertainty_m)}</div>
            <div className="compass-freshness">
                {/* Jammed: the arrow points at where they were, and the line says so instead */}
                {direction && !jammed && <span className="compass-cardinal-direction">Head {direction} · </span>}
                {vague && !jammed && <span data-testid="target-vague">±{formatDistance(target.uncertainty_m)} · </span>}
                {jammed ? <span className="meta-warning" data-testid="target-jammed">{freshness}</span>
                    : vague ? freshness.replace('updated ', '') : freshness}
            </div>
        </div>
    );
}

export default TargetReadout;
