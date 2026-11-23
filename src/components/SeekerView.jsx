import { useEffect, useState } from 'react';
import { IonButton, IonIcon, IonSegment, IonSegmentButton, IonLabel } from '@ionic/react';
import { chevronBackOutline } from 'ionicons/icons';
import CompassArrow from './CompassArrow';
import TrackMap from './TrackMap';
import TargetReadout from './TargetReadout';
import useNow from '../hooks/useNow';
import { calculateDistance, calculateBearing } from '../utils/geo';
import { bearingToCardinal } from '../utils/orientation';
import { PlayerListCard, PlayerRow } from './PlayerList';
import { playerName } from '../utils/players';

const TEST_IDS = {
    card: 'targets-card', title: 'targets-title', list: 'targets-list', empty: 'no-targets',
    row: 'target-card', name: 'target-name', distance: 'target-distance'
};

// Each seeker's choice of compass or map is remembered on their phone
const TRACK_MODE_KEY = 'manhunt.trackMode';

function loadTrackMode()
{
    try { return localStorage.getItem(TRACK_MODE_KEY) === 'map' ? 'map' : 'compass'; } catch { return 'compass'; }
}

function SeekerView({ players, avatars = {}, currentLocation, playArea = null })
{
    const now = useNow();
    const [selectedId, setSelectedId] = useState(null);
    const [mode, setMode] = useState(loadTrackMode);

    function chooseMode(next)
    {
        setMode(next);
        try { localStorage.setItem(TRACK_MODE_KEY, next); } catch { /* not remembered */ }
    }

    // A hider who is jamming has vanished: off the list, off the map, and
    // if they were being tracked, back to the list. (The server sends no
    // position for them either, so there is nothing to show)
    const everyHider = players.filter((player) => !player.is_seeker);
    const hiders = everyHider.filter((player) => !player.jammed_until);
    const seekers = players.filter((player) => player.is_seeker);
    const distanceTo = (player) =>
        calculateDistance(currentLocation.latitude, currentLocation.longitude, player.latitude, player.longitude);

    // A selected hider who left, switched roles or jams simply drops back to the list
    const selected = hiders.find((h) => h.player_id === selectedId);
    // And stays there: when a hider who jammed comes back, the seeker picks
    // them again from the list, not thrown back onto their compass
    useEffect(() =>
    {
        if (selectedId !== null && !selected) setSelectedId(null);
    }, [selectedId, selected]);

    if (selected)
    {
        const bearing = calculateBearing(currentLocation.latitude, currentLocation.longitude, selected.latitude, selected.longitude);
        return (
            <div className={`compass-screen track-screen track-screen--${mode}`} data-testid="compass-screen" data-mode={mode}>
                <div className="track-bar">
                    <IonButton
                        data-testid="compass-back"
                        fill="clear"
                        size="small"
                        className="compass-back-btn"
                        onClick={() => setSelectedId(null)}
                    >
                        <IonIcon slot="start" icon={chevronBackOutline} />
                        Hiders
                    </IonButton>
                    <IonSegment
                        className={`role-segment track-mode track-mode--${mode}`}
                        value={mode}
                        onIonChange={(e) => chooseMode(e.detail.value)}
                        aria-label="Track with"
                    >
                        <IonSegmentButton value="compass" data-testid="track-compass">
                            <IonLabel>Compass</IonLabel>
                        </IonSegmentButton>
                        <IonSegmentButton value="map" data-testid="track-map-btn">
                            <IonLabel>Map</IonLabel>
                        </IonSegmentButton>
                    </IonSegment>
                </div>
                {mode === 'compass' ? (
                    <CompassArrow
                        target={selected}
                        targetName={playerName(selected)}
                        currentLocation={currentLocation}
                        distance={distanceTo(selected)}
                        onClick={() => setSelectedId(null)}
                    />
                ) : (
                    <>
                        <TrackMap
                            you={currentLocation}
                            target={selected}
                            hiders={hiders}
                            seekers={seekers}
                            playArea={playArea}
                            onSelect={setSelectedId}
                            now={now}
                        />
                        {/* North is up unless the map is turned with the phone, so the direction in words helps */}
                        <TargetReadout
                            target={selected}
                            name={playerName(selected)}
                            distance={distanceTo(selected)}
                            direction={bearing === null ? null : bearingToCardinal(bearing)}
                        />
                    </>
                )}
            </div>
        );
    }

    return (
        <PlayerListCard
            title="Hiders"
            count={hiders.length}
            emptyText={everyHider.length ? 'No hider can be tracked right now' : 'No hiders in this lobby yet'}
            testIds={TEST_IDS}
        >
            {hiders.map((hider) => (
                <PlayerRow
                    key={hider.player_id}
                    player={hider}
                    avatar={avatars[hider.player_id]}
                    distance={distanceTo(hider)}
                    now={now}
                    onClick={() => setSelectedId(hider.player_id)}
                    testIds={TEST_IDS}
                />
            ))}
        </PlayerListCard>
    );
}

export default SeekerView;
