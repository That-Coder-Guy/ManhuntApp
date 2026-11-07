/**
 * The GPS fix dot — Manhunt's one signature detail. Solid when a player's
 * position is fresh, a hollow ring when it is stale or they are offline, so
 * patchy signal reads at a glance next to every name.
 */
function FixDot({ fresh, offline = false })
{
    const label = offline ? 'Offline' : fresh ? 'Location is current' : 'Location is out of date';
    return (
        <span
            className={`fix-dot ${fresh && !offline ? 'fix-dot--fresh' : 'fix-dot--stale'}`}
            role="img"
            aria-label={label}
        />
    );
}

export default FixDot;
