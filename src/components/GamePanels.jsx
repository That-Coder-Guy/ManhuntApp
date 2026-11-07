import { useState } from 'react';
import { IonItem, IonLabel, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonIcon, IonToast } from '@ionic/react';
import { warningOutline } from 'ionicons/icons';
import useNow from '../hooks/useNow';
import { formatDistance } from '../utils/geo';
import { formatClock, describeSettings, playAreaStatus, gameClock } from '../utils/game';

/** One fixed-height row summarising the rules; opens the settings sheet */
export function SettingsRow({ settings, isHost, onOpen })
{
    const { playArea, timeLimit, headStart } = describeSettings(settings);
    return (
        <IonItem button detail className="name-card settings-row" data-testid="settings-row" onClick={onOpen}>
            <IonLabel>
                <h2>Game settings</h2>
                <p className="player-freshness" data-testid="settings-summary">
                    {[playArea, timeLimit, headStart !== 'None' && `${headStart} head start`].filter(Boolean).join(' · ')}
                </p>
            </IonLabel>
            <span slot="end" className="settings-row-action">{isHost ? 'Edit' : 'View'}</span>
        </IonItem>
    );
}

/**
 * In-game status: the clock (head start, time left, or time played) and where
 * this player stands against the play area. Fixed height.
 */
export function GameStatusCard({ game, settings, isSeeker, location, clockOffset, onOpenMap })
{
    const now = useNow(500);
    const clock = gameClock(game, now + clockOffset);
    const area = playAreaStatus(settings?.geofence, location);

    let label = 'Time played';
    let value = formatClock(clock?.elapsedMs ?? 0);
    if (clock?.kind === 'head_start')
    {
        label = isSeeker ? 'Hiders are hiding' : 'Head start · hide now';
        value = formatClock(clock.remainingMs);
    }
    else if (clock?.kind === 'limit')
    {
        label = 'Time left';
        value = formatClock(clock.remainingMs);
    }

    return (
        <IonItem
            lines="none"
            button={!!onOpenMap}
            detail={false}
            className="name-card status-card"
            data-testid="game-status"
            onClick={onOpenMap}
            aria-label={onOpenMap ? 'Game status. Tap to see the play area map' : undefined}
        >
            <div className="status-row">
                <div className="status-clock">
                    <span className="status-label">{label}</span>
                    <span className="status-value" data-testid="game-clock">{value}</span>
                </div>
                <div className="status-side">
                    <span className="status-role" data-testid="game-role">{isSeeker ? 'Seeker' : 'Hider'}</span>
                    {!settings?.geofence ? (
                        <span className="status-area">No play area</span>
                    ) : !area ? (
                        <span className="status-area">Finding your position</span>
                    ) : area.outside ? (
                        <span className="status-area status-area--out" data-testid="out-of-bounds">
                            <IonIcon icon={warningOutline} aria-hidden="true" />
                            Outside · {formatDistance(area.distanceToEdge)} back, head {area.directionBack}
                        </span>
                    ) : (
                        <span className="status-area">In play area · {formatDistance(area.distanceToEdge)} to edge</span>
                    )}
                </div>
            </div>
        </IonItem>
    );
}

const RESULT_TEXT = {
    time_up: "Time's up. The hiders win.",
    host_ended: 'The host ended the game.'
};

export function GameOverCard({ game })
{
    const played = game?.ended_at && game?.head_start_ends_at ? Math.max(0, game.ended_at - game.head_start_ends_at) : 0;
    return (
        <IonCard className="game-over-card" data-testid="game-over">
            <IonCardHeader>
                <IonCardTitle>Game over</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
                <p className="game-over-result">{RESULT_TEXT[game?.result?.reason] ?? 'The game has ended.'}</p>
                <p className="player-freshness">Played {formatClock(played)}</p>
            </IonCardContent>
        </IonCard>
    );
}

/**
 * The bar under the lobby and the game-over screen: the host's next action,
 * or what everyone else is waiting for. Always the same height.
 */
export function PhaseFooter({ phase, isHost, hostName, canStart, hostActions })
{
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState('');

    async function run(action)
    {
        setIsBusy(true);
        try {
            await action();
        } catch (err) {
            setError(err.status === 'network_error'
                ? "Couldn't reach the server. Check your connection and try again."
                : err.message || 'That didn’t work. Try again.');
        } finally {
            setIsBusy(false);
        }
    }

    const waitingFor = hostName ? `Waiting for ${hostName}` : 'Waiting for the host';

    return (
        <div className="phase-footer" data-testid="phase-footer">
            {isHost && phase === 'lobby' && (
                <>
                    <IonButton expand="block" data-testid="start-game" disabled={!canStart || isBusy} onClick={() => run(hostActions.startGame)}>
                        {isBusy ? 'Starting…' : 'Start game'}
                    </IonButton>
                    <p className="phase-footer-hint">{canStart ? 'Everyone gets the rules when you start' : 'Needs at least one seeker and one hider'}</p>
                </>
            )}
            {isHost && phase === 'ended' && (
                <>
                    <IonButton expand="block" data-testid="reset-game" disabled={isBusy} onClick={() => run(hostActions.resetGame)}>
                        Back to the lobby
                    </IonButton>
                    <p className="phase-footer-hint">Keep the same players for another round</p>
                </>
            )}
            {!isHost && (
                <p className="phase-footer-waiting" data-testid="waiting-for-host">
                    {phase === 'lobby' ? `${waitingFor} to start the game` : `${waitingFor} to start another round`}
                </p>
            )}
            <IonToast isOpen={!!error} message={error} duration={4000} onDidDismiss={() => setError('')} />
        </div>
    );
}
