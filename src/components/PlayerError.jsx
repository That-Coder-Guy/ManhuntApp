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
                <div className="page-column">
                    <IonCard className="ion-margin-top">
                        <IonCardHeader>
                            <IonCardTitle>Session expired</IonCardTitle>
                        </IonCardHeader>
                        <IonCardContent>
                            <p>You were away too long, so the lobby let your spot go. Rejoin to keep playing.</p>
                            <IonButton
                                data-testid="rejoin-btn"
                                expand="block"
                                onClick={() => { window.location.href = `/lobby/${lobbyId}`; }}
                            >
                                Rejoin lobby
                            </IonButton>
                            <IonButton
                                data-testid="home-btn"
                                expand="block"
                                className="button-secondary"
                                onClick={() => navigate('/')}
                            >
                                Go home
                            </IonButton>
                        </IonCardContent>
                    </IonCard>
                </div>
            </IonContent>
        </IonPage>
    );
}

export default PlayerError;
