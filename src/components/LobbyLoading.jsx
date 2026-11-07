import { IonPage, IonContent, IonSpinner } from '@ionic/react';

function LobbyLoading() {
    return (
        <IonPage data-testid="loading-page">
            <IonContent className="ion-padding">
                <div className="page-column">
                    <div className="loading-block">
                        <IonSpinner name="crescent" />
                        <p>Joining lobby</p>
                    </div>
                </div>
            </IonContent>
        </IonPage>
    );
}

export default LobbyLoading;
