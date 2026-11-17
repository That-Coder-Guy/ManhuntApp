import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonFooter,
    IonButtons, IonButton, IonIcon, IonAlert, IonToast
} from '@ionic/react';
import { qrCodeOutline, peopleOutline, exitOutline, stopCircleOutline } from 'ionicons/icons';
import ProfileCard from './ProfileCard';
import RoleSwitcher from './RoleSwitcher';
import LobbyPlayers from './LobbyPlayers';
import SettingsSheet from './SettingsSheet';
import SeekerView from './SeekerView';
import HiderView from './HiderView';
import PlayerTableModal from './PlayerTableModal';
import ShareModal from './ShareModal';
import ConnectionBanner from './ConnectionBanner';
import { PlayerListCard } from './PlayerList';
import { SettingsRow, GameStatusCard, GameOverCard, PhaseFooter, FoundFooter } from './GamePanels';
import { PHASE } from '../hooks/useLobbySocket';
import useGeolocation from '../hooks/useGeolocation';
import useWakeLock from '../hooks/useWakeLock';
import { useLocationPermission, useKeepScreenOn, notifyOffered, markNotifyOffered } from '../hooks/usePermissions';
import { pushStatus, enablePush } from '../utils/push';
import { isInstalled } from '../utils/install';
import { withDummyPlayers } from '../utils/dummyPlayers';
import { playerName } from '../utils/players';
import { useUpdateReady, applyAppUpdate } from '../utils/appUpdate';

const LOBBY_LIST_IDS = { card: 'lobby-players-card', title: 'lobby-players-title', list: 'lobby-players-list', empty: 'no-players' };

/**
 * One lobby, through its three phases:
 *   lobby   — pregame: profile, role, rules, players; the host starts it
 *   playing — the hunt: status card plus the seeker or hider view
 *   ended   — result; the host takes everyone back to the lobby
 */
function LobbyFound({ lobbyId, lobby, onLeft })
{
    const navigate = useNavigate();
    const {
        lobbyName, selfPlayer, players, phase, hostId, isHost, settings, game, seekerInfo, avatars,
        clockOffset, connectionState, lastSyncTime, updateLocation, updatePlayer, setAvatar,
        declareFound, foundNotice, pushKey, registerPush, hostActions, leaveLobby
    } = lobby;

    // Location is followed once it's allowed; otherwise it's asked for when
    // the game starts (or when the host wants the map centred on them)
    const [locationStatus] = useLocationPermission();
    const [locationAsked, setLocationAsked] = useState(false);
    const wantLocation = phase === PHASE.PLAYING || locationStatus === 'granted' || locationAsked;
    const { location: currentLocation, gpsError, gpsDenied } = useGeolocation(wantLocation, updateLocation);

    // The screen stays on during a game, unless turned off in Settings
    const [keepScreenOn] = useKeepScreenOn();
    useWakeLock(phase === PHASE.PLAYING && keepScreenOn);

    // In the browser, notifications are offered as a game starts (once; the
    // installed app asked when it first opened). Turning them on needs a tap
    const [notifyAnswered, setNotifyAnswered] = useState(false);
    const offerNotifications = phase === PHASE.PLAYING && !!pushKey && !notifyAnswered
        && !isInstalled() && pushStatus() === 'prompt' && !notifyOffered();

    async function turnOnNotifications()
    {
        markNotifyOffered();
        try {
            // Asked first, in the tap itself
            const permission = await Notification.requestPermission();
            if (permission === 'granted') await registerPush(await enablePush(pushKey));
        } catch (err) {
            console.warn('[Notifications] Could not turn them on:', err);
        }
    }

    const [isPlayersOpen, setIsPlayersOpen] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false);
    const [isEndConfirmOpen, setIsEndConfirmOpen] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    // A new app version waits out a game; between rounds it can be applied
    const updateReady = useUpdateReady();

    const isSeeker = !!selfPlayer?.is_seeker;
    const everyone = selfPlayer ? [selfPlayer, ...players] : players;
    const host = everyone.find((p) => p.player_id === hostId);
    const canStart = everyone.some((p) => p.is_seeker) && everyone.some((p) => !p.is_seeker);
    const showEnd = isHost && phase === PHASE.PLAYING;

    const listProps = {
        players: everyone,
        selfId: selfPlayer?.player_id,
        hostId,
        isHost,
        avatars,
        hostActions
    };

    // Tell everyone when a hider is found
    useEffect(() =>
    {
        if (!foundNotice) return;
        const isMe = foundNotice.player_id === selfPlayer?.player_id;
        const who = everyone.find((p) => p.player_id === foundNotice.player_id);
        const name = who ? playerName(who) : foundNotice.name || 'A hider';
        const left = foundNotice.hiders_left;
        setNotice(isMe
            ? 'You’re a seeker now. Go find the others.'
            : `${name} was found · ${left === 0 ? 'everyone is found' : `${left} ${left === 1 ? 'hider' : 'hiders'} left`}`);
        // Only a new notice should trigger this, not every lobby update
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [foundNotice]);

    // leaveLobby never rejects: offline, the server just expires the player
    async function handleLeave()
    {
        await leaveLobby();
        onLeft();
        navigate('/');
    }

    function handleEndGame()
    {
        hostActions.endGame().catch((err) => setError(err.message || "Couldn't end the game."));
    }

    return (
        <IonPage data-testid="lobby-page" data-phase={phase}>
            <IonHeader>
                <IonToolbar className={showEnd ? 'toolbar--four' : undefined}>
                    <IonTitle data-testid="lobby-title">{lobbyName}</IonTitle>
                    <IonButtons slot="end">
                        <IonButton data-testid="invite-btn" onClick={() => setIsShareOpen(true)} aria-label="Invite players">
                            <IonIcon slot="icon-only" icon={qrCodeOutline} />
                        </IonButton>
                        <IonButton data-testid="players-btn" onClick={() => setIsPlayersOpen(true)} aria-label="View players">
                            <IonIcon slot="icon-only" icon={peopleOutline} />
                        </IonButton>
                        {showEnd && (
                            <IonButton data-testid="end-game-btn" onClick={() => setIsEndConfirmOpen(true)} aria-label="End the game">
                                <IonIcon slot="icon-only" icon={stopCircleOutline} />
                            </IonButton>
                        )}
                        <IonButton data-testid="leave-btn" onClick={() => setIsLeaveConfirmOpen(true)} aria-label="Leave lobby">
                            <IonIcon slot="icon-only" icon={exitOutline} />
                        </IonButton>
                    </IonButtons>
                </IonToolbar>
                {/* Banners live in the fixed header, so they can never overlap content */}
                <ConnectionBanner connectionState={connectionState} lastSyncTime={lastSyncTime} gpsError={gpsError} gpsDenied={gpsDenied} />
                {updateReady && phase !== PHASE.PLAYING && (
                    <div className="connection-banner update-banner" role="status" data-testid="update-banner">
                        <span>A new version of the app is ready ·</span>
                        <button type="button" className="link-button" onClick={applyAppUpdate}>Reload</button>
                    </div>
                )}
            </IonHeader>

            <IonContent className="ion-padding lobby-content" data-testid="lobby-content">
                <div className="lobby-body">
                    {phase === PHASE.LOBBY && (
                        <>
                            <div className="lobby-body-top">
                                <ProfileCard
                                    player={selfPlayer}
                                    avatar={avatars[selfPlayer?.player_id]}
                                    updatePlayer={updatePlayer}
                                    setAvatar={setAvatar}
                                />
                                <RoleSwitcher isSeeker={isSeeker} updatePlayer={updatePlayer} />
                                <SettingsRow settings={settings} isHost={isHost} onOpen={() => setIsSettingsOpen(true)} />
                            </div>
                            <div className="lobby-body-main">
                                <PlayerListCard title="Players" count={everyone.length} emptyText="" testIds={LOBBY_LIST_IDS}>
                                    <LobbyPlayers {...listProps} />
                                </PlayerListCard>
                            </div>
                        </>
                    )}

                    {phase === PHASE.PLAYING && (
                        <>
                            <div className="lobby-body-top">
                                <GameStatusCard
                                    game={game}
                                    settings={settings}
                                    isSeeker={isSeeker}
                                    location={currentLocation}
                                    clockOffset={clockOffset}
                                    onOpenMap={settings?.geofence ? () => setIsSettingsOpen(true) : undefined}
                                />
                            </div>
                            <div className="lobby-body-main">
                                {isSeeker ? (
                                    <SeekerView
                                        players={withDummyPlayers(players)}
                                        avatars={avatars}
                                        currentLocation={currentLocation}
                                        playArea={settings?.geofence?.points ?? null}
                                    />
                                ) : (
                                    <HiderView seekerInfo={seekerInfo} />
                                )}
                            </div>
                        </>
                    )}

                    {phase === PHASE.ENDED && (
                        <div className="lobby-body-main">
                            <GameOverCard game={game} players={everyone} />
                        </div>
                    )}
                </div>
            </IonContent>

            {phase === PHASE.PLAYING && !isSeeker && (
                <IonFooter className="phase-footer-bar">
                    <FoundFooter
                        game={game}
                        settings={settings}
                        location={currentLocation}
                        seekerInfo={seekerInfo}
                        clockOffset={clockOffset}
                        declareFound={declareFound}
                    />
                </IonFooter>
            )}

            {phase !== PHASE.PLAYING && (
                <IonFooter className="phase-footer-bar">
                    <PhaseFooter
                        phase={phase}
                        isHost={isHost}
                        hostName={host ? playerName(host) : null}
                        canStart={canStart}
                        hostActions={hostActions}
                    />
                </IonFooter>
            )}

            <IonToast
                isOpen={!!notice}
                message={notice}
                duration={3500}
                position="top"
                cssClass="found-toast"
                onDidDismiss={() => setNotice('')}
            />

            <IonAlert
                isOpen={isLeaveConfirmOpen}
                cssClass="leave-alert"
                header="Leave lobby?"
                message={isHost ? "You'll be removed, and the host role passes to the next player." : "You'll be removed from the game."}
                buttons={[
                    { text: 'Cancel', role: 'cancel' },
                    { text: 'Leave', role: 'destructive', handler: handleLeave }
                ]}
                onDidDismiss={() => setIsLeaveConfirmOpen(false)}
            />

            <IonAlert
                isOpen={isEndConfirmOpen}
                cssClass="end-alert"
                header="End the game?"
                message="Everyone goes to the results screen."
                buttons={[
                    { text: 'Keep playing', role: 'cancel' },
                    { text: 'End game', role: 'destructive', handler: handleEndGame }
                ]}
                onDidDismiss={() => setIsEndConfirmOpen(false)}
            />

            <SettingsSheet
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                settings={settings}
                isHost={isHost}
                canEdit={phase === PHASE.LOBBY}
                currentLocation={currentLocation}
                onRequestLocation={() => setLocationAsked(true)}
                updateSettings={hostActions.updateSettings}
            />

            <IonToast
                isOpen={offerNotifications}
                position="top"
                cssClass="notify-offer-toast"
                message="Get a notification when players are found, even with your phone locked?"
                buttons={[
                    { text: 'Not now', role: 'cancel' },
                    { text: 'Turn on', handler: () => { turnOnNotifications(); } }
                ]}
                onDidDismiss={() =>
                {
                    markNotifyOffered();
                    setNotifyAnswered(true);
                }}
            />

            <ShareModal lobbyId={lobbyId} isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} />

            <PlayerTableModal
                isOpen={isPlayersOpen}
                onClose={() => setIsPlayersOpen(false)}
                showFreshness={phase === PHASE.PLAYING}
                {...listProps}
            />

            <IonToast isOpen={!!error} message={error} duration={4000} onDidDismiss={() => setError('')} />
        </IonPage>
    );
}

export default LobbyFound;
