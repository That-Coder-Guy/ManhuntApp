import { IonPage, IonContent, IonSpinner } from '@ionic/react';

function LobbyLoading() {
    return (
        <IonPage data-testid="loading-page">
            <IonContent className="ion-padding">
                <div className="ion-text-center" style={{ marginTop: '40vh' }}>
                    <IonSpinner name="crescent" style={{ width: 48, height: 48 }} />
                    <h2>Joining Lobby…</h2>
                    <p>Please wait while we connect you to the lobby.</p>
                </div>
            </IonContent>
        </IonPage>
    );
}

export default LobbyLoading;
