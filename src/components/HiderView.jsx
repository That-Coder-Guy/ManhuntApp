import { useEffect, useRef, useState } from 'react';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonSegment, IonSegmentButton, IonLabel } from '@ionic/react';
import TrackMap from './TrackMap';
import useNow from '../hooks/useNow';
import { formatDistance } from '../utils/geo';

// Each hider's choice of the seekers card or the map is remembered on their phone
const HIDER_MODE_KEY = 'manhunt.hiderMode';

function loadMode()
{
    try { return localStorage.getItem(HIDER_MODE_KEY) === 'map' ? 'map' : 'info'; } catch { return 'info'; }
}

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

/**
 * How exactly the seekers are seeing this hider right now, which is theirs
 * to change: stay still to stay vague. `seenWithin` is the radius the server
 * is giving the seekers (0: the exact position; null: not shown at all, or
 * jamming, which the jammer card covers).
 */
function seenLine(seenWithin)
{
    if (seenWithin == null) return null;
    return seenWithin > 0
        ? `Seekers see you within ${formatDistance(seenWithin)}`
        : 'Moving · seekers see exactly where you are';
}

/**
 * The hider's screen during a game, in two modes:
 *   Seekers — what the host lets hiders know about the seekers
 *   Map     — where this hider and their fellow hiders are, and the play
 *             area. Hiders see each other as the seekers see them (an area
 *             while still, frozen while jamming), so that one who is caught
 *             joins the seekers knowing no more than they do. No seeker is
 *             on it
 */
function HiderView({ seekerInfo, seenWithin = null, self = null, players = [], currentLocation = null, playArea = null })
{
    const now = useNow();
    const [mode, setMode] = useState(loadMode);
    const view = describe(seekerInfo);
    const seen = seenLine(seenWithin);
    const fellows = players.filter((player) => !player.is_seeker);

    function chooseMode(next)
    {
        setMode(next);
        try { localStorage.setItem(HIDER_MODE_KEY, next); } catch { /* not remembered */ }
    }

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
        <div className={`hider-screen track-screen track-screen--${mode === 'map' ? 'map' : 'compass'}`} data-testid="hider-screen" data-mode={mode}>
            <IonSegment
                className={`role-segment hider-mode track-mode--${mode === 'map' ? 'map' : 'compass'}`}
                value={mode}
                onIonChange={(e) => chooseMode(e.detail.value)}
                aria-label="Show"
            >
                <IonSegmentButton value="info" data-testid="hider-info-btn">
                    <IonLabel>Seekers</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="map" data-testid="hider-map-btn">
                    <IonLabel>Map</IonLabel>
                </IonSegmentButton>
            </IonSegment>
            {mode === 'map' ? (
                <>
                    <TrackMap
                        you={currentLocation}
                        youAre="hider"
                        self={self}
                        hiders={fellows}
                        playArea={playArea}
                        now={now}
                    />
                    <p className="hider-map-note" data-testid="hider-map-note">
                        {fellows.length === 0 ? 'You’re the only hider' : `You and ${fellows.length} other ${fellows.length === 1 ? 'hider' : 'hiders'}`}
                        {' · seekers aren’t shown'}
                    </p>
                </>
            ) : (
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
                {seen && (
                    <p className={`hider-seen${seenWithin > 0 ? '' : ' hider-seen--exact'}`} data-testid="hider-seen">{seen}</p>
                )}
            </IonCardContent>
        </IonCard>
            )}
        </div>
    );
}

export default HiderView;
