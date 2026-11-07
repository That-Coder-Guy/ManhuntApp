import { initials } from '../utils/avatar';
import FixDot from './FixDot';

/**
 * A player's small round picture, or their initials when they have none.
 * With `dot`, the GPS fix dot sits on its lower edge.
 */
function Avatar({ name, src, size = 'sm', dot = null, className = '' })
{
    return (
        <span className={`avatar avatar--${size} ${className}`.trim()}>
            {src
                ? <img className="avatar-img" src={src} alt="" draggable="false" />
                : <span className="avatar-initials" aria-hidden="true">{initials(name)}</span>}
            {dot && (
                <span className="avatar-dot">
                    <FixDot fresh={dot.fresh} offline={dot.offline} />
                </span>
            )}
        </span>
    );
}

export default Avatar;
