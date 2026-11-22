import { useState } from 'react';
import { IonItem, IonLabel, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonIcon, IonToast, IonAlert } from '@ionic/react';
import { warningOutline } from 'ionicons/icons';
import useNow from '../hooks/useNow';
import { formatDistance } from '../utils/geo';
import {
    formatClock, formatDuration, describeSettings, playAreaStatus, gameClock, foundStatus, jamView, jamSettings,
    FOUND_RANGE_DEFAULT_M, SEEKER_INFO_DEFAULT, JAM_DEFAULTS, HIDER_BLUR_DEFAULT_M
} from '../utils/game';
import { playerName } from '../utils/players';

/** One fixed-height row summarising the rules; opens the settings sheet */
export function SettingsRow({ settings, isHost, onOpen })
{
    const { playArea, timeLimit, headStart, foundRange, seekerInfo, jamming, hiderBlur } = describeSettings(settings);
    // The found range, seeker info, jamming and hider positions only show when the host changed them, to keep the line short
    const customBlur = (settings?.hider_blur_m ?? HIDER_BLUR_DEFAULT_M) !== HIDER_BLUR_DEFAULT_M;
    const customRange = (settings?.found_range_m ?? FOUND_RANGE_DEFAULT_M) !== FOUND_RANGE_DEFAULT_M;
    const customInfo = (settings?.seeker_info ?? SEEKER_INFO_DEFAULT) !== SEEKER_INFO_DEFAULT;
    const jam = jamSettings(settings);
    const customJam = ['enabled', 'duration_s', 'charge_s'].some((key) => jam[key] !== JAM_DEFAULTS[key]);
    return (
        <IonItem
            button
            detail
            className="name-card settings-row"
            data-testid="settings-row"
            aria-label={isHost ? 'Edit game settings' : 'View game settings'}
            onClick={onOpen}
        >
            <IonLabel>
                <h2>Game settings</h2>
                <p className="player-freshness" data-testid="settings-summary">
                    {[playArea, timeLimit, headStart !== 'None' && `${headStart} head start`, customRange && `found ≤ ${foundRange}`, customInfo && seekerInfo,
                        customBlur && hiderBlur, customJam && jamming]
                        .filter(Boolean).join(' · ')}
                </p>
            </IonLabel>
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

/**
 * The hider's jammer: how charged it is, and the button that sets it off.
 * While it runs, the seekers keep the position this hider had when it
 * started. Nothing is drawn when the host has turned jamming off. Fixed height.
 */
export function JamCard({ jam, clockOffset, startJam })
{
    const now = useNow(500);
    const view = jamView(jam, now + clockOffset);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState('');
    if (!view) return null;

    const status = {
        charging: `Charging · ready in ${formatClock(view.remainingMs)}`,
        // (short enough for one line on a narrow phone)
        ready: `Ready · hides you for ${formatDuration(jam.duration_s)}`,
        active: `Hidden from seekers · ${formatClock(view.remainingMs)} left`
    }[view.state];

    async function run()
    {
        setIsBusy(true);
        try {
            await startJam();
        } catch (err) {
            setError(err.status === 'network_error'
                ? "Couldn't reach the server. Check your connection and try again."
                : err.message || 'That didn’t work. Try again.');
        } finally {
            setIsBusy(false);
        }
    }

    return (
        <IonItem lines="none" className={`name-card jam-card jam-card--${view.state}`} data-testid="jam-card" data-state={view.state}>
            <div className="jam-row">
                <div className="jam-text">
                    <span className="jam-title">Jammer</span>
                    <span className="jam-status" data-testid="jam-status">{status}</span>
                    {/* Fills as it charges, empties as a jam runs out */}
                    <span className="jam-bar" aria-hidden="true">
                        <span className="proximity-bar-fill" style={{ transform: `scaleX(${view.progress})` }} />
                    </span>
                </div>
                <IonButton
                    size="small"
                    className="jam-btn"
                    data-testid="jam-btn"
                    disabled={view.state !== 'ready' || isBusy}
                    onClick={run}
                >
                    {view.state === 'active' ? 'Jamming' : 'Jam'}
                </IonButton>
            </div>
            <IonToast isOpen={!!error} message={error} duration={4000} onDidDismiss={() => setError('')} />
        </IonItem>
    );
}

const RESULT_TEXT = {
    all_found: 'Everyone was found. The seekers win.',
    time_up: "Time's up. The hiders win.",
    host_ended: 'The host ended the game.',
    no_hiders: 'No hiders are left.'
};

export function GameOverCard({ game, players = [] })
{
    const played = game?.ended_at && game?.head_start_ends_at ? Math.max(0, game.ended_at - game.head_start_ends_at) : 0;
    const found = game?.found ?? [];
    const nameOf = (id) => {
        const player = players.find((p) => p.player_id === id);
        return player ? playerName(player) : 'A player who left';
    };
    return (
        <IonCard className="game-over-card" data-testid="game-over">
            <IonCardHeader>
                <IonCardTitle>Game over</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
                <p className="game-over-result" data-testid="game-over-result">{RESULT_TEXT[game?.result?.reason] ?? 'The game has ended.'}</p>
                <p className="player-freshness">Played {formatClock(played)}</p>
                {found.length > 0 && (
                    <>
                        <h3 className="found-list-title">Found</h3>
                        <ol className="found-list" data-testid="found-list">
                            {found.map(({ player_id: id, at }) => (
                                <li key={id}>
                                    <span className="found-list-name">{nameOf(id)}</span>
                                    {/* When, on the game clock (from the seekers' release) */}
                                    <span className="found-list-time">{formatClock(Math.max(0, at - game.head_start_ends_at))}</span>
                                </li>
                            ))}
                        </ol>
                    </>
                )}
            </IonCardContent>
        </IonCard>
    );
}

/**
 * The hider's footer during the game: "I've been found", unlocked while a
 * seeker is within the lobby's found range. Asks first, then the server
 * checks the distance again and moves the hider to the seekers.
 */
export function FoundFooter({ game, settings, location, seekerInfo, clockOffset, declareFound })
{
    const now = useNow(1000);
    const status = foundStatus({ game, settings, location, seekerInfo, serverNow: now + clockOffset });
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState('');

    const range = formatDistance(status.range);
    const hint = {
        head_start: 'Unlocks once the head start is over',
        no_fix: 'Waiting for your position',
        no_seeker: `Unlocks when a seeker is within ${range}`,
        out_of_range: `Nearest seeker ${formatDistance(status.distance)} away · unlocks within ${range}`,
        in_range: `A seeker is ${formatDistance(status.distance)} away`,
        unknown: `Tap once a seeker is within ${range} of you`
    }[status.state];

    async function confirm()
    {
        setIsBusy(true);
        try {
            await declareFound(location);
        } catch (err) {
            setError(err.status === 'network_error'
                ? "Couldn't reach the server. Check your connection and try again."
                : err.message || 'That didn’t work. Try again.');
        } finally {
            setIsBusy(false);
        }
    }

    return (
        <div className="phase-footer" data-testid="found-footer">
            <IonButton
                expand="block"
                data-testid="found-btn"
                disabled={!['in_range', 'unknown'].includes(status.state) || isBusy}
                onClick={() => setIsConfirmOpen(true)}
            >
                {isBusy ? 'Sending…' : 'I’ve been found'}
            </IonButton>
            <p className="phase-footer-hint" data-testid="found-hint">{hint}</p>
            <IonAlert
                isOpen={isConfirmOpen}
                cssClass="found-alert"
                header="Were you found?"
                message="You’ll join the seekers for the rest of the game."
                buttons={[
                    { text: 'Not yet', role: 'cancel' },
                    { text: 'I’ve been found', handler: confirm }
                ]}
                onDidDismiss={() => setIsConfirmOpen(false)}
            />
            <IonToast isOpen={!!error} message={error} duration={4000} onDidDismiss={() => setError('')} />
        </div>
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
                    <p className="phase-footer-hint">Everyone gets their starting role back</p>
                </>
            )}
            {!isHost && (
                <p className="phase-footer-waiting" data-testid="waiting-for-host">
                    {phase === 'lobby' ? `${waitingFor} to start the game` : `${waitingFor} to go back to the lobby`}
                </p>
            )}
            <IonToast isOpen={!!error} message={error} duration={4000} onDidDismiss={() => setError('')} />
        </div>
    );
}
