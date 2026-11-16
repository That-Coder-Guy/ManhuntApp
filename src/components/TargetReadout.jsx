import useNow from '../hooks/useNow';
import { formatDistance } from '../utils/geo';
import { playerFreshness } from '../utils/players';
import FixDot from './FixDot';

/**
 * The lines under the compass dial or the tracking map: who, how far, and how
 * fresh their position is, with "Head NE" first when a direction in words
 * helps. Always the same lines, so nothing shifts as values change.
 */
function TargetReadout({ target, name, distance, direction = null })
{
    const now = useNow();
    const { fresh, offline, label: freshness } = playerFreshness(target, now);

    return (
        <div className="compass-readout" data-testid="target-readout">
            <div className="compass-player-name">
                <FixDot fresh={fresh} offline={offline} />
                <span className="compass-player-name-text">{name}</span>
            </div>
            <div className="compass-distance-display" data-testid="target-readout-distance">{formatDistance(distance)}</div>
            <div className="compass-freshness">
                {direction && <span className="compass-cardinal-direction">Head {direction} · </span>}
                {freshness}
            </div>
        </div>
    );
}

export default TargetReadout;
