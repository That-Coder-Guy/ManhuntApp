import { useNavigate } from 'react-router-dom';
import {
    IonPage, IonContent, IonCard, IonCardHeader, IonCardTitle,
    IonCardContent, IonButton
} from '@ionic/react';

function PlayerError({ lobbyId }) {
    const navigate = useNavigate();

    return (
        <IonPage data-testid="timeout-page">
            <IonContent className="ion-padding">
                <IonCard className="ion-margin-top">
                    <IonCardHeader>
                        <IonCardTitle>Player Timed Out</IonCardTitle>
                    </IonCardHeader>
                    <IonCardContent>
                        <p>Your player session has expired. Rejoin the lobby to continue playing.</p>
                        <IonButton
                            data-testid="rejoin-btn"
                            expand="block"
                            onClick={() => { window.location.href = `/lobby/${lobbyId}`; }}
                        >
                            Rejoin Lobby
                        </IonButton>
                        <IonButton
                            data-testid="home-btn"
                            expand="block"
                            fill="outline"
                            onClick={() => navigate('/')}
                        >
                            Go Home
                        </IonButton>
                    </IonCardContent>
                </IonCard>
            </IonContent>
        </IonPage>
    );
}

export default PlayerError;
