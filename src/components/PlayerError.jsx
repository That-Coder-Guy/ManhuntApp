import { useNavigate } from 'react-router-dom';
import {
    IonPage, IonContent, IonCard, IonCardHeader, IonCardTitle,
    IonCardContent, IonButton
} from '@ionic/react';
import { lobbyPath } from '../utils/lobbyLink';

// The player's spot in the lobby is gone: it expired, or the host removed them
function PlayerError({ lobbyId, kicked = false })
{
    const navigate = useNavigate();

    return (
        <IonPage data-testid={kicked ? 'kicked-page' : 'timeout-page'}>
            <IonContent className="ion-padding">
                <div className="page-column">
                    <IonCard className="ion-margin-top">
                        <IonCardHeader>
                            <IonCardTitle>{kicked ? 'Removed from the lobby' : 'Session expired'}</IonCardTitle>
                        </IonCardHeader>
                        <IonCardContent>
                            <p>
                                {kicked
                                    ? 'The host removed you from this lobby.'
                                    : 'You were away too long, so the lobby let your spot go. Rejoin to keep playing.'}
                            </p>
                            {!kicked && (
                                <IonButton
                                    data-testid="rejoin-btn"
                                    expand="block"
                                    onClick={() => window.location.assign(lobbyPath(lobbyId))}
                                >
                                    Rejoin lobby
                                </IonButton>
                            )}
                            <IonButton
                                data-testid="home-btn"
                                expand="block"
                                className={kicked ? undefined : 'button-secondary'}
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
