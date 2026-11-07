import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonInput, IonButton, IonIcon, IonToast
} from '@ionic/react';
import { qrCodeOutline } from 'ionicons/icons';
import BrandMark from '../components/BrandMark.jsx';
import { createLobby } from '../utils/api.js';
import QrScanModal from '../components/QrScanModal.jsx';
import { parseLobbyId, lobbyPath } from '../utils/lobbyLink.js';

function Home()
{
    const [newLobbyName, setNewLobbyName] = useState('');
    const [joinLobbyId, setJoinLobbyId] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [toast, setToast] = useState('');
    const navigate = useNavigate();

    async function createLobbyClick()
    {
        const name = newLobbyName.trim();
        if (!name) return setToast('Name the lobby first');

        setIsCreating(true);
        try {
            const { lobby_id: lobbyId } = await createLobby(name);
            navigate(lobbyPath(lobbyId));
        } catch (error) {
            console.error('Error creating lobby:', error);
            setToast("Couldn't create the lobby. Check your connection and try again.");
        } finally {
            setIsCreating(false);
        }
    }

    function joinLobbyClick()
    {
        if (!joinLobbyId.trim()) return setToast('Enter a lobby ID or invite link');

        const lobbyId = parseLobbyId(joinLobbyId);
        if (!lobbyId) return setToast("That isn't a lobby ID or invite link");
        navigate(lobbyPath(lobbyId));
    }

    // Invite codes encode the join URL, so a scan joins straight away, the
    // same as when the phone's own camera opens the link
    function handleScan(scannedText)
    {
        setIsScannerOpen(false);
        const lobbyId = parseLobbyId(scannedText);
        if (!lobbyId) return setToast("That QR code isn't a Manhunt invite");
        navigate(lobbyPath(lobbyId));
    }

    return (
        <IonPage data-testid="home-page">
            <IonHeader>
                <IonToolbar>
                    <IonTitle>
                        <span className="brand">
                            <BrandMark />
                            Manhunt
                        </span>
                    </IonTitle>
                </IonToolbar>
            </IonHeader>
            <IonContent className="ion-padding">
                <div className="home-center page-column">
                <header className="home-intro">
                    <h1>Play manhunt outdoors</h1>
                    <p>
                        Seekers follow a live compass to each hider. Hiders see how
                        close every seeker is.
                    </p>
                </header>

                <IonCard>
                    <IonCardHeader>
                        <IonCardTitle>Start a game</IonCardTitle>
                    </IonCardHeader>
                    <IonCardContent>
                        <IonInput
                            data-testid="create-name-input"
                            className="field-input"
                            placeholder="Lobby name"
                            aria-label="Lobby name"
                            value={newLobbyName}
                            onIonInput={(e) => setNewLobbyName(e.detail.value ?? '')}
                        />
                        <IonButton
                            data-testid="create-btn"
                            expand="block"
                            className="ion-margin-top"
                            onClick={createLobbyClick}
                            disabled={isCreating}
                        >
                            {isCreating ? 'Creating…' : 'Create lobby'}
                        </IonButton>
                    </IonCardContent>
                </IonCard>

                <IonCard>
                    <IonCardHeader>
                        <IonCardTitle>Join a game</IonCardTitle>
                    </IonCardHeader>
                    <IonCardContent>
                        <div className="join-row">
                            <IonInput
                                data-testid="join-id-input"
                                className="field-input"
                                placeholder="Lobby ID or invite link"
                                aria-label="Lobby ID or invite link"
                                value={joinLobbyId}
                                onIonInput={(e) => setJoinLobbyId(e.detail.value ?? '')}
                            />
                            <IonButton
                                data-testid="scan-qr-btn"
                                className="qr-scan-btn"
                                aria-label="Scan a lobby QR code"
                                onClick={() => setIsScannerOpen(true)}
                            >
                                <IonIcon slot="icon-only" icon={qrCodeOutline} />
                            </IonButton>
                        </div>
                        <IonButton
                            data-testid="join-btn"
                            expand="block"
                            className="ion-margin-top button-secondary"
                            onClick={joinLobbyClick}
                        >
                            Join lobby
                        </IonButton>
                    </IonCardContent>
                </IonCard>
                </div>

                <QrScanModal
                    isOpen={isScannerOpen}
                    onClose={() => setIsScannerOpen(false)}
                    onScan={handleScan}
                />

                <IonToast
                    isOpen={!!toast}
                    message={toast}
                    duration={2500}
                    onDidDismiss={() => setToast('')}
                />
            </IonContent>
        </IonPage>
    );
}

export default Home;
