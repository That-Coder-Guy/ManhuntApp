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
                <div className="page-column">
                    <IonCard className="ion-margin-top">
                        <IonCardHeader>
                            <IonCardTitle>Can't join this lobby</IonCardTitle>
                        </IonCardHeader>
                        <IonCardContent>
                            <p>The lobby didn't answer. Usually it's one of these:</p>
                            <ul>
                                <li>Weak or no signal</li>
                                <li>The game server is down</li>
                                <li>The lobby ID is wrong or the lobby has ended</li>
                            </ul>
                            <IonButton
                                data-testid="retry-btn"
                                expand="block"
                                onClick={() => window.location.reload()}
                            >
                                Try again
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

export default LobbyError;
