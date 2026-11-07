import {
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonItem, IonLabel, IonNote, IonIcon
} from '@ionic/react';
import { warningOutline } from 'ionicons/icons';
import FixDot from './FixDot';
import { formatDistance } from '../utils/geo';
import { playerFreshness, playerName } from '../utils/players';

/**
 * The fixed-height card that holds a player list. It fills the space below
 * the role switcher whether it has zero rows or fifty; rows scroll inside.
 */
export function PlayerListCard({ title, count, emptyText, testIds, children })
{
    return (
        <IonCard className="targets-card" data-testid={testIds.card}>
            <IonCardHeader className="targets-card-header">
                <IonCardTitle data-testid={testIds.title}>{title}</IonCardTitle>
                <span className="targets-count">{count}</span>
            </IonCardHeader>
            <IonCardContent className="targets-card-content">
                {count === 0 ? (
                    <IonNote className="targets-empty" data-testid={testIds.empty}>{emptyText}</IonNote>
                ) : (
                    <div className="targets-item-stack" data-testid={testIds.list}>{children}</div>
                )}
            </IonCardContent>
        </IonCard>
    );
}

/**
 * One player: fix dot, name, freshness line and distance. Optionally a
 * "close" flag and a proximity bar (hider view), or a tap target (seeker view).
 */
export function PlayerRow({ player, distance, now, danger = false, proximity = null, onClick, testIds })
{
    const { fresh, offline, label } = playerFreshness(player, now);

    return (
        <IonItem
            button={!!onClick}
            detail={!!onClick}
            lines="none"
            data-testid={testIds.row}
            className={`targets-item${fresh ? '' : ' player-stale'}${danger ? ' targets-item--danger' : ''}`}
            onClick={onClick}
        >
            <FixDot fresh={fresh} offline={offline} />
            <IonLabel>
                <h2 data-testid={testIds.name}>{playerName(player)}</h2>
                <p className="player-freshness">{label}</p>
            </IonLabel>
            <span
                slot="end"
                className={`target-distance${danger ? ' target-distance--danger' : ''}`}
                data-testid={testIds.distance}
            >
                {danger && (
                    <IonIcon icon={warningOutline} className="proximity-flag-icon" role="img" aria-label="Seeker is close" />
                )}
                {formatDistance(distance)}
            </span>
            {proximity !== null && (
                <span className="proximity-bar" aria-hidden="true">
                    <span className="proximity-bar-fill" style={{ transform: `scaleX(${proximity})` }} />
                </span>
            )}
        </IonItem>
    );
}
