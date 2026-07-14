import { useNavigate } from 'react-router-dom';
import {
    IonPage, IonContent, IonCard, IonCardHeader, IonCardTitle,
    IonCardContent, IonButton
} from '@ionic/react';

function LobbyError() {
    const navigate = useNavigate();

    return (
        <IonPage data-testid="error-page">
            <IonContent className="ion-padding">
                <IonCard className="ion-margin-top">
                    <IonCardHeader>
                        <IonCardTitle>Unable to Join Lobby</IonCardTitle>
                    </IonCardHeader>
                    <IonCardContent>
                        <p>We couldn't connect you to the lobby. This might be caused by:</p>
                        <ul>
                            <li>Temporary network issues</li>
                            <li>Server downtime</li>
                            <li>An invalid or expired lobby ID</li>
                        </ul>
                        <IonButton
                            data-testid="retry-btn"
                            expand="block"
                            onClick={() => window.location.reload()}
                        >
                            Try Again
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

export default LobbyError;
