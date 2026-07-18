import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonInput, IonButton, IonToast
} from '@ionic/react';
import { createLobby } from '../utils/api.js';

function Home()
{
    const [newLobbyName, setNewLobbyName] = useState('');
    const [joinLobbyId, setJoinLobbyId] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [toast, setToast] = useState('');
    const navigate = useNavigate();

    async function createLobbyClick()
    {
        if (!newLobbyName.trim())
        {
            setToast('Please enter a lobby name first!');
            return;
        }

        setIsCreating(true);
        try {
            const data = await createLobby(newLobbyName.trim());
            navigate(`/lobby/${encodeURIComponent(data.lobby_id)}`);
        } catch (error) {
            console.error('Error creating lobby:', error);
            setToast('Failed to create lobby. Please check your connection and try again.');
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
            setToast('Please enter a lobby ID or invite link first!');
        }
        else
        {
            navigate(`/lobby/${encodeURIComponent(lobbyId)}`);
        }
    }

    return (
        <IonPage data-testid="home-page">
            <IonHeader>
                <IonToolbar>
                    <IonTitle>Manhunt</IonTitle>
                </IonToolbar>
            </IonHeader>
            <IonContent className="ion-padding">
                <div className="home-center">
                <IonCard>
                    <IonCardHeader>
                        <IonCardTitle>Create New Lobby</IonCardTitle>
                    </IonCardHeader>
                    <IonCardContent>
                        <IonInput
                            data-testid="create-name-input"
                            fill="solid"
                            className="glass-input"
                            placeholder="Enter lobby name"
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
                            {isCreating ? 'Creating…' : 'Create Lobby'}
                        </IonButton>
                    </IonCardContent>
                </IonCard>

                <IonCard>
                    <IonCardHeader>
                        <IonCardTitle>Join Existing Lobby</IonCardTitle>
                    </IonCardHeader>
                    <IonCardContent>
                        <IonInput
                            data-testid="join-id-input"
                            fill="solid"
                            className="glass-input"
                            placeholder="Enter lobby ID or paste invite link"
                            value={joinLobbyId}
                            onIonInput={(e) => setJoinLobbyId(e.detail.value ?? '')}
                        />
                        <IonButton
                            data-testid="join-btn"
                            expand="block"
                            color="success"
                            className="ion-margin-top"
                            onClick={joinLobbyClick}
                        >
                            Join Lobby
                        </IonButton>
                    </IonCardContent>
                </IonCard>
                </div>

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
