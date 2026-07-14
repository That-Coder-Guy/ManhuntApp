import { useState, useEffect, useRef } from 'react';
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

    // Current GPS position (kept locally so own distances work even offline)
    const [currentLocation, setCurrentLocation] = useState({
        latitude: null,
        longitude: null
    });
    const [gpsError, setGpsError] = useState(false);

    const [isPlayerTableOpen, setIsPlayerTableOpen] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false);

    // Keep the latest updateLocation without retriggering the geolocation watch
    const updateLocationRef = useRef(updateLocation);
    updateLocationRef.current = updateLocation;

    // Continuously watch the device position once permissions are granted.
    // GPS often works when the network doesn't: local state always updates,
    // while uploads are throttled/dropped by the socket hook as needed.
    useEffect(() =>
    {
        if (!permissionsGranted) return undefined;

        if (!navigator.geolocation)
        {
            setGpsError(true);
            return undefined;
        }

        const watchId = navigator.geolocation.watchPosition(
            (position) =>
            {
                setGpsError(false);
                const { latitude, longitude } = position.coords;
                setCurrentLocation({ latitude, longitude });
                updateLocationRef.current(latitude, longitude);
            },
            (error) =>
            {
                console.warn('Geolocation error:', error);
                setGpsError(true);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 5000,
                timeout: 15000
            }
        );

        return () => navigator.geolocation.clearWatch(watchId);
    }, [permissionsGranted]);

    async function handleLeave()
    {
        try {
            await leaveLobby();
        } catch (error) {
            console.error('Error leaving lobby:', error);
        } finally {
            onClearSession();
            navigate('/');
        }
    }

    return (
        <IonPage data-testid="lobby-page">
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
                            color="danger"
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

            <IonContent className="ion-padding" data-testid="lobby-content">
                <PlayerNameEditor
                    currentName={playerName}
                    updatePlayer={updatePlayer}
                />

                <RoleSwitcher
                    isSeeker={isSeeker}
                    updatePlayer={updatePlayer}
                />

                {isSeeker ? (
                    <SeekerView
                        players={players}
                        currentLocation={currentLocation}
                    />
                ) : (
                    <HiderView
                        players={players}
                        currentLocation={currentLocation}
                    />
                )}
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
                players={players}
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
