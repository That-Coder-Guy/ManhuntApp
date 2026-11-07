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

// Lobby IDs are server-generated UUIDs. Scanned codes are checked against this
// so pointing the camera at an unrelated QR reports a clear error instead of
// sending the player to a lobby that was never going to exist.
const LOBBY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
        if (!newLobbyName.trim())
        {
            setToast('Name the lobby first');
            return;
        }

        setIsCreating(true);
        try {
            const data = await createLobby(newLobbyName.trim());
            navigate(`/lobby/${encodeURIComponent(data.lobby_id)}`);
        } catch (error) {
            console.error('Error creating lobby:', error);
            setToast("Couldn't create the lobby. Check your connection and try again.");
        } finally {
            setIsCreating(false);
        }
    }

    // Accept either a bare lobby ID or a full invite URL (…/lobby/<id>)
    function extractLobbyId(input)
    {
        const trimmed = input.trim();
        const match = trimmed.match(/\/lobby\/([^/?#]+)/);
        const raw = match ? match[1] : trimmed;
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    }

    function joinLobbyClick()
    {
        const lobbyId = extractLobbyId(joinLobbyId);
        if (!lobbyId)
        {
            setToast('Enter a lobby ID or invite link');
        }
        else
        {
            navigate(`/lobby/${encodeURIComponent(lobbyId)}`);
        }
    }

    // Invite codes encode the join URL, so a scan joins straight away — the
    // same thing that happens when the phone's own camera opens the link.
    function handleScan(scannedText)
    {
        const lobbyId = extractLobbyId(scannedText);
        if (!LOBBY_ID_PATTERN.test(lobbyId))
        {
            setIsScannerOpen(false);
            setToast("That QR code isn't a Manhunt invite");
            return;
        }

        setIsScannerOpen(false);
        navigate(`/lobby/${encodeURIComponent(lobbyId)}`);
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
