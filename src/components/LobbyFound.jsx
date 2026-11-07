import { useState } from 'react';
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
import { SettingsRow, GameStatusCard, GameOverCard, PhaseFooter } from './GamePanels';
import { PHASE } from '../hooks/useLobbySocket';
import useGeolocation from '../hooks/useGeolocation';
import { withDummyPlayers } from '../utils/dummyPlayers';
import { playerName } from '../utils/players';

const LOBBY_LIST_IDS = { card: 'lobby-players-card', title: 'lobby-players-title', list: 'lobby-players-list', empty: 'no-players' };

/**
 * One lobby, through its three phases:
 *   lobby   — pregame: profile, role, rules, players; the host starts it
 *   playing — the hunt: status card plus the seeker or hider view
 *   ended   — result; the host takes everyone back to the lobby
 */
function LobbyFound({ lobbyId, lobby, onLeft, permissionsGranted = false })
{
    const navigate = useNavigate();
    const {
        lobbyName, selfPlayer, players, phase, hostId, isHost, settings, game, avatars,
        clockOffset, connectionState, lastSyncTime, updateLocation, updatePlayer, setAvatar,
        hostActions, leaveLobby
    } = lobby;

    const { location: currentLocation, gpsError } = useGeolocation(permissionsGranted, updateLocation);

    const [isPlayersOpen, setIsPlayersOpen] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false);
    const [isEndConfirmOpen, setIsEndConfirmOpen] = useState(false);
    const [error, setError] = useState('');

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
        <IonPage
            className={!permissionsGranted ? 'permissions-dialog-background' : undefined}
            data-testid="lobby-page"
            data-phase={phase}
        >
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
                <ConnectionBanner connectionState={connectionState} lastSyncTime={lastSyncTime} gpsError={gpsError} />
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
                                    <SeekerView players={withDummyPlayers(players)} avatars={avatars} currentLocation={currentLocation} />
                                ) : (
                                    <HiderView players={withDummyPlayers(players)} avatars={avatars} currentLocation={currentLocation} />
                                )}
                            </div>
                        </>
                    )}

                    {phase === PHASE.ENDED && (
                        <div className="lobby-body-main">
                            <GameOverCard game={game} />
                        </div>
                    )}
                </div>
            </IonContent>

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
                updateSettings={hostActions.updateSettings}
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
