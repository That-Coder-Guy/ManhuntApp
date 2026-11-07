import { useState } from 'react';
import { IonItem, IonLabel, IonButton, IonIcon, IonActionSheet, IonAlert, IonToast } from '@ionic/react';
import { ellipsisHorizontal } from 'ionicons/icons';
import Avatar from './Avatar';
import useNow from '../hooks/useNow';
import { playerFreshness, playerName } from '../utils/players';

/**
 * Everyone in the lobby with their picture, role and host badge. For the
 * host, each other player gets a menu: switch role, make host, remove.
 * `showFreshness` adds "updated 12s ago" (during a game).
 */
function LobbyPlayers({ players, selfId, hostId, isHost, avatars, hostActions, showFreshness = false })
{
    const now = useNow(1000, showFreshness);
    const [menuFor, setMenuFor] = useState(null);
    const [confirmKick, setConfirmKick] = useState(null);
    const [error, setError] = useState('');

    // Host first, then in joining order
    const sorted = [...players].sort((a, b) =>
        ((b.player_id === hostId) - (a.player_id === hostId)) || (a.player_id - b.player_id));

    const run = (action) => action().catch((err) => setError(err.status === 'network_error'
        ? "Couldn't reach the server. Check your connection and try again."
        : err.message || 'That didn’t work. Try again.'));

    const target = menuFor && players.find((p) => p.player_id === menuFor);

    return (
        <>
            <div className="targets-item-stack" data-testid="lobby-players">
                {sorted.map((player) => {
                    const isSelf = player.player_id === selfId;
                    const isPlayerHost = player.player_id === hostId;
                    const { fresh, offline, label } = playerFreshness(player, now);
                    const meta = [
                        isPlayerHost && 'Host',
                        player.is_seeker ? 'Seeker' : 'Hider',
                        showFreshness ? label : offline && 'Offline'
                    ].filter(Boolean).join(' · ');

                    return (
                        <IonItem
                            key={player.player_id}
                            lines="none"
                            className={`targets-item lobby-player-row${offline ? ' player-stale' : ''}`}
                            data-testid="lobby-player"
                            data-player-id={player.player_id}
                        >
                            <Avatar
                                name={playerName(player)}
                                src={avatars[player.player_id]}
                                dot={{ fresh: showFreshness ? fresh : !offline, offline }}
                                className="row-avatar"
                            />
                            <IonLabel>
                                <h2>
                                    <span className="row-name">{playerName(player)}</span>
                                    {isSelf && <span className="you-tag">you</span>}
                                </h2>
                                <p className="player-freshness">{meta}</p>
                            </IonLabel>
                            {isHost && !isSelf && (
                                <IonButton
                                    slot="end"
                                    fill="clear"
                                    className="row-menu-btn"
                                    aria-label={`Manage ${playerName(player)}`}
                                    data-testid="player-menu"
                                    onClick={() => setMenuFor(player.player_id)}
                                >
                                    <IonIcon slot="icon-only" icon={ellipsisHorizontal} />
                                </IonButton>
                            )}
                        </IonItem>
                    );
                })}
            </div>

            <IonActionSheet
                isOpen={!!target}
                header={target ? playerName(target) : ''}
                cssClass="player-actions"
                buttons={target ? [
                    {
                        text: target.is_seeker ? 'Make a hider' : 'Make a seeker',
                        handler: () => run(() => hostActions.setRole(target.player_id, !target.is_seeker))
                    },
                    { text: 'Make host', handler: () => run(() => hostActions.transferHost(target.player_id)) },
                    { text: 'Remove from lobby', role: 'destructive', handler: () => setConfirmKick(target) },
                    { text: 'Cancel', role: 'cancel' }
                ] : []}
                onDidDismiss={() => setMenuFor(null)}
            />

            <IonAlert
                isOpen={!!confirmKick}
                cssClass="kick-alert"
                header={confirmKick ? `Remove ${playerName(confirmKick)}?` : ''}
                message="They leave the lobby. They can only come back with the invite."
                buttons={[
                    { text: 'Cancel', role: 'cancel' },
                    { text: 'Remove', role: 'destructive', handler: () => run(() => hostActions.kickPlayer(confirmKick.player_id)) }
                ]}
                onDidDismiss={() => setConfirmKick(null)}
            />

            <IonToast isOpen={!!error} message={error} duration={4000} onDidDismiss={() => setError('')} />
        </>
    );
}

export default LobbyPlayers;
