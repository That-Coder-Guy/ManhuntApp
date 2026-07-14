import {
    IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent
} from '@ionic/react';
import PlayerTable from './PlayerTable';

function PlayerTableModal({ players, currentPlayer, isOpen, onClose }) {
    return (
        <IonModal isOpen={isOpen} onDidDismiss={onClose} data-testid="players-modal">
            <IonHeader>
                <IonToolbar>
                    <IonTitle>Players in Lobby</IonTitle>
                    <IonButtons slot="end">
                        <IonButton data-testid="players-close" onClick={onClose}>Close</IonButton>
                    </IonButtons>
                </IonToolbar>
            </IonHeader>
            <IonContent className="ion-padding">
                <PlayerTable players={players} currentPlayer={currentPlayer} />
            </IonContent>
        </IonModal>
    );
}

export default PlayerTableModal;
