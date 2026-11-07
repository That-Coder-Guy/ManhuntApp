import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonButton, IonIcon, IonAlert
} from '@ionic/react';
import { qrCodeOutline, peopleOutline, exitOutline } from 'ionicons/icons';
import PlayerNameEditor from './PlayerNameEditor';
import RoleSwitcher from './RoleSwitcher';
import SeekerView from './SeekerView';
import HiderView from './HiderView';
import PlayerTableModal from './PlayerTableModal';
import ShareModal from './ShareModal';
import ConnectionBanner from './ConnectionBanner';
import { withDummyPlayers } from '../utils/dummyPlayers';
import useGeolocation from '../hooks/useGeolocation';

function LobbyFound({
    lobbyId,
    lobbyName,
    selfPlayer,
    players,
    connectionState,
    lastSyncTime,
    lastLocationSentAt,
    updateLocation,
    updatePlayer,
    leaveLobby,
    onClearSession,
    permissionsGranted = false
})
{
    const navigate = useNavigate();
    const { player_id, name: playerName, is_seeker: isSeeker } = selfPlayer || {};

    const { location: currentLocation, gpsError } = useGeolocation(permissionsGranted, updateLocation);

    const [isPlayerTableOpen, setIsPlayerTableOpen] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false);

    const displayPlayers = withDummyPlayers(players);

    // leaveLobby never rejects: offline, the server just expires the player
    async function handleLeave()
    {
        await leaveLobby();
        onClearSession();
        navigate('/');
    }

    return (
        <IonPage
            className={!permissionsGranted ? 'permissions-dialog-background' : undefined}
            data-testid="lobby-page"
        >
            <IonHeader>
                <IonToolbar>
                    <IonTitle data-testid="lobby-title">{lobbyName}</IonTitle>
                    <IonButtons slot="end">
                        <IonButton
                            data-testid="invite-btn"
                            onClick={() => setIsShareOpen(true)}
                            aria-label="Invite players"
                        >
                            <IonIcon slot="icon-only" icon={qrCodeOutline} />
                        </IonButton>
                        <IonButton
                            data-testid="players-btn"
                            onClick={() => setIsPlayerTableOpen(true)}
                            aria-label="View players"
                        >
                            <IonIcon slot="icon-only" icon={peopleOutline} />
                        </IonButton>
                        <IonButton
                            data-testid="leave-btn"
                            onClick={() => setIsLeaveConfirmOpen(true)}
                            aria-label="Leave lobby"
                        >
                            <IonIcon slot="icon-only" icon={exitOutline} />
                        </IonButton>
                    </IonButtons>
                </IonToolbar>
                {/* Banners live in the fixed header, so they can never overlap content */}
                <ConnectionBanner
                    connectionState={connectionState}
                    lastSyncTime={lastSyncTime}
                    gpsError={gpsError}
                />
            </IonHeader>

            <IonContent className="ion-padding lobby-content" data-testid="lobby-content">
                <div className="lobby-body">
                    <div className="lobby-body-top">
                        <PlayerNameEditor
                            currentName={playerName}
                            updatePlayer={updatePlayer}
                        />

                        <RoleSwitcher
                            isSeeker={isSeeker}
                            updatePlayer={updatePlayer}
                        />
                    </div>

                    <div className="lobby-body-main">
                        {isSeeker ? (
                            <SeekerView
                                players={displayPlayers}
                                currentLocation={currentLocation}
                            />
                        ) : (
                            <HiderView
                                players={displayPlayers}
                                currentLocation={currentLocation}
                            />
                        )}
                    </div>
                </div>
            </IonContent>

            <IonAlert
                isOpen={isLeaveConfirmOpen}
                cssClass="leave-alert"
                header="Leave lobby?"
                message="You'll be removed from the game."
                buttons={[
                    { text: 'Cancel', role: 'cancel' },
                    { text: 'Leave', role: 'destructive', handler: handleLeave }
                ]}
                onDidDismiss={() => setIsLeaveConfirmOpen(false)}
            />

            <ShareModal
                lobbyId={lobbyId}
                isOpen={isShareOpen}
                onClose={() => setIsShareOpen(false)}
            />

            <PlayerTableModal
                players={displayPlayers}
                currentPlayer={{
                    player_id: player_id,
                    name: playerName,
                    is_seeker: isSeeker,
                    connected: true,
                    location_last_updated: lastLocationSentAt
                }}
                isOpen={isPlayerTableOpen}
                onClose={() => setIsPlayerTableOpen(false)}
            />
        </IonPage>
    );
}

export default LobbyFound;
