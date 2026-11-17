import { useEffect, useRef } from 'react';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent } from '@ionic/react';
import { formatDistance } from '../utils/geo';

// Closer than this, the nearest seeker is flagged
const DANGER_DISTANCE_M = 100;
// The proximity bar is empty at this distance and full at zero
const PROXIMITY_RANGE_M = 1000;

const proximityFill = (distance) =>
    distance == null ? 0 : Math.min(1, Math.max(0.03, 1 - distance / PROXIMITY_RANGE_M));

/**
 * What this hider may know about the seekers, as the host set it. The server
 * works it out (seekers' positions never reach a hider's phone):
 *   distance — how far away the nearest seeker is
 *   nearby   — only whether one is within the alert distance
 *   none     — nothing
 */
function describe(info)
{
    const mode = info?.mode ?? 'distance';
    if (mode === 'none')
    {
        return {
            mode, tag: 'Hidden', label: 'Seeker info is off', status: 'Stay sharp',
            caption: 'The host turned off seeker info for this game. Watch and listen.'
        };
    }
    if (mode === 'nearby')
    {
        const within = formatDistance(info.alert_m);
        if (info.nearby == null) return { mode, tag: `Alert · ${within}`, label: 'Seeker alert', status: '—', caption: 'Waiting for your position' };
        return info.nearby
            ? { mode, tag: `Alert · ${within}`, label: 'Seeker alert', status: 'Seeker nearby', danger: true, caption: `A seeker is within ${within} of you` }
            : { mode, tag: `Alert · ${within}`, label: 'Seeker alert', status: 'All clear', caption: `No seeker within ${within}` };
    }
    const distance = info?.distance_m ?? null;
    const danger = distance != null && distance < DANGER_DISTANCE_M;
    return {
        mode: 'distance', tag: 'Distance', label: 'Nearest seeker', figure: formatDistance(distance), danger,
        proximity: proximityFill(distance),
        caption: distance == null ? 'No seeker has a recent position' : danger ? 'Close · stay out of sight' : 'Updates as everyone moves'
    };
}

function HiderView({ seekerInfo })
{
    const view = describe(seekerInfo);

    // A buzz when a seeker comes into alert range, for a phone in a pocket
    // (Android; iPhones don't vibrate for web pages)
    const wasNearby = useRef(false);
    const nearbyNow = view.mode === 'nearby' && view.danger === true;
    useEffect(() =>
    {
        if (nearbyNow && !wasNearby.current) navigator.vibrate?.([200, 100, 200]);
        wasNearby.current = nearbyNow;
    }, [nearbyNow]);

    return (
        <IonCard className="targets-card seeker-info-card" data-testid="seeker-info" data-mode={view.mode}>
            <IonCardHeader className="targets-card-header">
                <IonCardTitle>Seekers</IonCardTitle>
                <span className="targets-count">{view.tag}</span>
            </IonCardHeader>
            <IonCardContent className="seeker-info-content">
                <div className="seeker-info-label">{view.label}</div>
                {view.figure !== undefined ? (
                    <div className={`seeker-info-figure${view.danger ? ' seeker-info--danger' : ''}`} data-testid="seeker-info-value">{view.figure}</div>
                ) : (
                    <div className={`seeker-info-status${view.danger ? ' seeker-info--danger' : ''}`} data-testid="seeker-info-value">{view.status}</div>
                )}
                <p className="seeker-info-caption" data-testid="seeker-info-caption">{view.caption}</p>
                {view.mode === 'distance' && (
                    <span className={`seeker-info-bar${view.danger ? ' seeker-info--danger' : ''}`} aria-hidden="true">
                        <span className="proximity-bar-fill" style={{ transform: `scaleX(${view.proximity})` }} />
                    </span>
                )}
            </IonCardContent>
        </IonCard>
    );
}

export default HiderView;
