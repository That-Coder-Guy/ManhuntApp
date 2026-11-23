import {
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonItem, IonLabel, IonNote
} from '@ionic/react';
import Avatar from './Avatar';
import { formatDistance, formatHiderDistance } from '../utils/geo';
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
 * One player: picture with fix dot, name, freshness line and distance;
 * optionally a tap target (the seeker's list of hiders).
 */
export function PlayerRow({ player, avatar, distance, now, onClick, testIds })
{
    const { fresh, offline, label } = playerFreshness(player, now);
    const outside = player.out_of_bounds;
    // A slow or still hider is only placed to within this many metres
    const vague = player.uncertainty_m > 0;

    return (
        <IonItem
            button={!!onClick}
            detail={!!onClick}
            lines="none"
            data-testid={testIds.row}
            className={`targets-item${fresh ? '' : ' player-stale'}`}
            onClick={onClick}
        >
            <Avatar name={playerName(player)} src={avatar} dot={{ fresh, offline }} className="row-avatar" />
            <IonLabel>
                <h2 data-testid={testIds.name}>{playerName(player)}</h2>
                <p className="player-freshness">
                    {/* The warning leads the line, so it is never the part cut off */}
                    {outside && <span className="meta-warning" data-testid="row-out-of-bounds">Outside ·</span>}
                    {outside && ' '}
                    {/* "Outside · 8s ago": the shorter form keeps the time from being cut off */}
                    {outside ? label.replace('updated ', '')
                        : vague ? <span data-testid="row-vague">{`±${formatDistance(player.uncertainty_m)} · ${label.replace('updated ', '')}`}</span>
                            : label}
                </p>
            </IonLabel>
            <span slot="end" className="target-distance" data-testid={testIds.distance}>
                {formatHiderDistance(distance, player.uncertainty_m)}
            </span>
        </IonItem>
    );
}
