import { useEffect, useState } from 'react';
import {
    IonCard, IonCardContent, IonList, IonItem, IonLabel, IonBadge, IonNote
} from '@ionic/react';
import { calculateDistance, formatDistance } from '../utils/geo';
import { getTimeAgo, isStale } from '../utils/time';

function HiderView({ players, currentLocation })
{
    // Filter to get only seekers
    const seekers = players.filter(player => player.is_seeker);

    // Tick every second so "updated Xs ago" labels stay current
    const [, setTick] = useState(0);
    useEffect(() =>
    {
        const intervalId = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(intervalId);
    }, []);

    if (seekers.length === 0) {
        return (
            <IonNote className="ion-text-center" style={{ display: 'block', padding: 24 }} data-testid="no-seekers">
                No seekers
            </IonNote>
        );
    }

    // Find closest seeker
    let closest = null;
    let minDistance = Infinity;
    seekers.forEach(seeker => {
        const distance = calculateDistance(
            currentLocation.latitude,
            currentLocation.longitude,
            seeker.latitude,
            seeker.longitude
        );
        if (distance !== null && distance < minDistance) {
            minDistance = distance;
            closest = seeker;
        }
    });
    const closestDistance = closest ? minDistance : null;
    const closestIsDanger = closestDistance !== null && closestDistance < 100;
    const closestStale = closest
        ? (isStale(closest.location_last_updated) || closest.connected === false)
        : false;

    return (
        <>
            <IonCard data-testid="closest-seeker">
                <IonCardContent className="ion-text-center">
                    <IonNote>Closest Seeker</IonNote>
                    <div className={`closest-distance ${closestIsDanger ? 'danger' : 'safe'}`} data-testid="closest-distance">
                        {closestIsDanger && (
                            <span className="proximity-flag" aria-label="Danger, seeker is close">⚠ Close</span>
                        )}
                        {formatDistance(closestDistance)}
                    </div>
                    {closest && closestStale && (
                        <IonNote className="player-freshness">
                            updated {getTimeAgo(closest.location_last_updated)}
                        </IonNote>
                    )}
                </IonCardContent>
            </IonCard>

            <h3 data-testid="seekers-title">Active Seekers: {seekers.length}</h3>
            <IonList inset data-testid="seekers-list">
                {seekers.map((seeker) => {
                    const distance = calculateDistance(
                        currentLocation.latitude,
                        currentLocation.longitude,
                        seeker.latitude,
                        seeker.longitude
                    );
                    const danger = distance !== null && distance < 100;
                    const stale = isStale(seeker.location_last_updated) || seeker.connected === false;

                    return (
                        <IonItem
                            key={seeker.player_id}
                            data-testid="seeker-card"
                            className={stale ? 'player-stale' : ''}
                        >
                            <IonLabel>
                                <h2>{seeker.name || `Player ${seeker.player_id}`}</h2>
                                <p className="player-freshness">
                                    {seeker.connected === false ? 'offline · ' : ''}
                                    {seeker.location_last_updated
                                        ? `updated ${getTimeAgo(seeker.location_last_updated)}`
                                        : 'no location yet'}
                                </p>
                            </IonLabel>
                            <IonBadge
                                slot="end"
                                className={danger ? 'distance-badge-danger' : 'distance-badge-safe'}
                                data-testid="seeker-distance"
                            >
                                {danger && <span className="proximity-flag-icon" aria-label="Seeker is close">⚠ </span>}
                                {formatDistance(distance)}
                            </IonBadge>
                        </IonItem>
                    );
                })}
            </IonList>
        </>
    );
}

export default HiderView;
