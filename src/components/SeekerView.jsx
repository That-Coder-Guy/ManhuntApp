import { useState, useEffect } from 'react';
import {
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonItem, IonLabel, IonButton, IonIcon, IonNote
} from '@ionic/react';
import { chevronBackOutline } from 'ionicons/icons';
import CompassArrow from './CompassArrow';
import FixDot from './FixDot';
import { calculateDistance, formatDistance } from '../utils/geo';
import { getTimeAgo, isStale } from '../utils/time';

function SeekerView({ players, currentLocation })
{
    // Filter to get only hiders
    const hiders = players.filter(player => !player.is_seeker);

    // Selected hider drives the compass screen
    const [selectedId, setSelectedId] = useState(null);
    const selectedHider = selectedId !== null
        ? hiders.find(h => h.player_id === selectedId) || null
        : null;

    // If the selected hider left or switched roles, fall back to the list
    useEffect(() => {
        if (selectedId !== null && !hiders.some(h => h.player_id === selectedId)) {
            setSelectedId(null);
        }
    }, [hiders, selectedId]);

    // Tick every second so "updated Xs ago" labels stay current
    const [, setTick] = useState(0);
    useEffect(() =>
    {
        const intervalId = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(intervalId);
    }, []);

    // Compass screen for the selected hider
    if (selectedHider) {
        const distance = calculateDistance(
            currentLocation.latitude,
            currentLocation.longitude,
            selectedHider.latitude,
            selectedHider.longitude
        );

        return (
            <div className="compass-screen" data-testid="compass-screen">
                <IonButton
                    data-testid="compass-back"
                    fill="clear"
                    size="small"
                    className="compass-back-btn"
                    onClick={() => setSelectedId(null)}
                >
                    <IonIcon slot="start" icon={chevronBackOutline} />
                    All hiders
                </IonButton>
                <CompassArrow
                    targetLatitude={selectedHider.latitude}
                    targetLongitude={selectedHider.longitude}
                    currentLocation={currentLocation}
                    targetName={selectedHider.name || `Player ${selectedHider.player_id}`}
                    distance={distance}
                    locationLastUpdated={selectedHider.location_last_updated}
                    isDisconnected={selectedHider.connected === false}
                    onClick={() => setSelectedId(null)}
                />
            </div>
        );
    }

    // Hider list
    return (
        <IonCard className="targets-card" data-testid="targets-card">
            <IonCardHeader className="targets-card-header">
                <IonCardTitle data-testid="targets-title">Hiders</IonCardTitle>
                <span className="targets-count">{hiders.length}</span>
            </IonCardHeader>
            <IonCardContent className="targets-card-content">
                {hiders.length === 0 ? (
                    <IonNote className="targets-empty" data-testid="no-targets">
                        No hiders in this lobby yet
                    </IonNote>
                ) : (
                    <div className="targets-item-stack" data-testid="targets-list">
                        {hiders.map((hider) => {
                            const distance = calculateDistance(
                                currentLocation.latitude,
                                currentLocation.longitude,
                                hider.latitude,
                                hider.longitude
                            );
                            const offline = hider.connected === false;
                            const stale = offline || isStale(hider.location_last_updated);

                            return (
                                <IonItem
                                    key={hider.player_id}
                                    button
                                    detail
                                    lines="none"
                                    data-testid="target-card"
                                    className={`targets-item ${stale ? 'player-stale' : ''}`.trim()}
                                    onClick={() => setSelectedId(hider.player_id)}
                                >
                                    <FixDot fresh={!stale} offline={offline} />
                                    <IonLabel>
                                        <h2 data-testid="target-name">{hider.name || `Player ${hider.player_id}`}</h2>
                                        <p className="player-freshness">
                                            {offline ? 'Offline · ' : ''}
                                            {hider.location_last_updated
                                                ? `updated ${getTimeAgo(hider.location_last_updated)}`
                                                : 'no location yet'}
                                        </p>
                                    </IonLabel>
                                    <span slot="end" className="target-distance" data-testid="target-distance">
                                        {formatDistance(distance)}
                                    </span>
                                </IonItem>
                            );
                        })}
                    </div>
                )}
            </IonCardContent>
        </IonCard>
    );
}

export default SeekerView;
