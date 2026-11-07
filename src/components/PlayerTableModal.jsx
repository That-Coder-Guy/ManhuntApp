import {
    IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent
} from '@ionic/react';
import LobbyPlayers from './LobbyPlayers';

// Everyone in the lobby, mid-game; the host can still move or remove people
function PlayerTableModal({ isOpen, onClose, ...listProps })
{
    return (
        <IonModal isOpen={isOpen} onDidDismiss={onClose} data-testid="players-modal">
            <IonHeader>
                <IonToolbar>
                    <IonTitle>Players</IonTitle>
                    <IonButtons slot="end">
                        <IonButton data-testid="players-close" onClick={onClose}>Close</IonButton>
                    </IonButtons>
                </IonToolbar>
            </IonHeader>
            <IonContent className="ion-padding">
                <LobbyPlayers {...listProps} />
            </IonContent>
        </IonModal>
    );
}

export default PlayerTableModal;
