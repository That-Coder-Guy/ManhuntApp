import { useEffect, useState } from 'react';
import {
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonItem, IonLabel, IonNote, IonIcon
} from '@ionic/react';
import { warningOutline } from 'ionicons/icons';
import FixDot from './FixDot';
import { calculateDistance, formatDistance } from '../utils/geo';
import { getTimeAgo, isStale } from '../utils/time';

// A seeker inside this range is flagged as close
const DANGER_DISTANCE_M = 100;
// The proximity bar is empty at this distance and full at zero
const PROXIMITY_RANGE_M = 1000;

function proximityFill(distance)
{
    if (distance === null) return 0;
    return Math.min(1, Math.max(0.03, 1 - distance / PROXIMITY_RANGE_M));
}

function HiderView({ players, currentLocation })
{
    const seekers = players.filter(player => player.is_seeker);

    // Tick every second so "updated Xs ago" labels stay current
    const [, setTick] = useState(0);
    useEffect(() =>
    {
        const intervalId = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(intervalId);
    }, []);

    // Closest first; seekers without a location go last
    const sortedSeekers = seekers
        .map(seeker => ({
            seeker,
            distance: calculateDistance(
                currentLocation.latitude,
                currentLocation.longitude,
                seeker.latitude,
                seeker.longitude
            )
        }))
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

    return (
        <IonCard className="targets-card" data-testid="seekers-card">
            <IonCardHeader className="targets-card-header">
                <IonCardTitle data-testid="seekers-title">Seekers</IonCardTitle>
                <span className="targets-count">{seekers.length}</span>
            </IonCardHeader>
            <IonCardContent className="targets-card-content">
                {seekers.length === 0 ? (
                    <IonNote className="targets-empty" data-testid="no-seekers">
                        No seekers in this lobby yet
                    </IonNote>
                ) : (
                    <div className="targets-item-stack" data-testid="seekers-list">
                        {sortedSeekers.map(({ seeker, distance }) => {
                            const danger = distance !== null && distance < DANGER_DISTANCE_M;
                            const offline = seeker.connected === false;
                            const stale = offline || isStale(seeker.location_last_updated);

                            return (
                                <IonItem
                                    key={seeker.player_id}
                                    lines="none"
                                    data-testid="seeker-card"
                                    className={`targets-item ${stale ? 'player-stale' : ''} ${danger ? 'targets-item--danger' : ''}`.trim()}
                                >
                                    <FixDot fresh={!stale} offline={offline} />
                                    <IonLabel>
                                        <h2>{seeker.name || `Player ${seeker.player_id}`}</h2>
                                        <p className="player-freshness">
                                            {offline ? 'Offline · ' : ''}
                                            {seeker.location_last_updated
                                                ? `updated ${getTimeAgo(seeker.location_last_updated)}`
                                                : 'no location yet'}
                                        </p>
                                    </IonLabel>
                                    <span
                                        slot="end"
                                        className={`target-distance ${danger ? 'target-distance--danger' : ''}`.trim()}
                                        data-testid="seeker-distance"
                                    >
                                        {danger && (
                                            <IonIcon
                                                icon={warningOutline}
                                                className="proximity-flag-icon"
                                                aria-label="Seeker is close"
                                                role="img"
                                            />
                                        )}
                                        {formatDistance(distance)}
                                    </span>
                                    {/* Proximity bar: fills as the seeker closes in */}
                                    <span className="proximity-bar" aria-hidden="true">
                                        <span
                                            className="proximity-bar-fill"
                                            style={{ transform: `scaleX(${proximityFill(distance)})` }}
                                        />
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

export default HiderView;
