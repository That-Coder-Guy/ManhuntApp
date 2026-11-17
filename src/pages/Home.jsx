import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonInput, IonButton, IonIcon, IonToast
} from '@ionic/react';
import { qrCodeOutline, settingsOutline } from 'ionicons/icons';
import BrandMark from '../components/BrandMark.jsx';
import { createLobby, fetchServerVersion } from '../utils/api.js';
import { APP_VERSION, formatVersion, isDifferentVersion } from '../utils/version.js';
import { useUpdateReady, applyAppUpdate } from '../utils/appUpdate.js';
import QrScanModal from '../components/QrScanModal.jsx';
import { parseLobbyId, lobbyPath } from '../utils/lobbyLink.js';
import { updateSession } from '../utils/session.js';

function Home()
{
    const [newLobbyName, setNewLobbyName] = useState('');
    const [joinLobbyId, setJoinLobbyId] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [toast, setToast] = useState('');
    const [serverVersion, setServerVersion] = useState(null);
    const navigate = useNavigate();

    // The server's version: if it differs, this phone is showing an older
    // (or newer) copy of the app than the server runs
    useEffect(() =>
    {
        let active = true;
        fetchServerVersion().then((version) => { if (active) setServerVersion(version); });
        return () => { active = false; };
    }, []);
    const outOfStep = isDifferentVersion(APP_VERSION, serverVersion);

    // A downloaded update applies itself here, unless that would throw away
    // something being typed; then the version line offers it instead
    const updateReady = useUpdateReady();
    const busy = !!newLobbyName.trim() || !!joinLobbyId.trim() || isCreating || isScannerOpen;
    useEffect(() =>
    {
        if (updateReady && !busy) applyAppUpdate();
    }, [updateReady, busy]);

    async function createLobbyClick()
    {
        const name = newLobbyName.trim();
        if (!name) return setToast('Name the lobby first');

        setIsCreating(true);
        try {
            const { lobby_id: lobbyId, host_key: hostKey } = await createLobby(name);
            // The key is what makes this player the host once they join
            updateSession(lobbyId, { hostKey });
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
                    <IonButtons slot="end">
                        <IonButton data-testid="open-settings" aria-label="Settings" onClick={() => navigate('/settings')}>
                            <IonIcon slot="icon-only" icon={settingsOutline} />
                        </IonButton>
                    </IonButtons>
                </IonToolbar>
            </IonHeader>
            <IonContent className="ion-padding home-content">
                <div className="home-center">
                <header className="home-intro">
                    <h1>Play manhunt outdoors</h1>
                    <p>
                        Seekers follow a live compass to each hider. Hiders see how
                        close every seeker is.
                    </p>
                </header>

                <div className="home-cards">
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

                {/* Which update this is, so you can tell one has gone through */}
                <footer className="home-version" data-testid="app-version">
                    <p>{formatVersion(APP_VERSION)}</p>
                    {updateReady ? (
                        <p className="home-version-update" data-testid="update-ready">
                            A new version is ready ·{' '}
                            <button type="button" className="link-button" onClick={applyAppUpdate}>Reload now</button>
                        </p>
                    ) : outOfStep && (
                        <p className="home-version-warning" data-testid="version-mismatch">
                            Server is on version {serverVersion.build ?? '?'} ({serverVersion.commit}). Reload to update.
                        </p>
                    )}
                </footer>
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
