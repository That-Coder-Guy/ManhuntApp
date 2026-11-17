import { useNavigate } from 'react-router-dom';
import { IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent } from '@ionic/react';
import { chevronBack } from 'ionicons/icons';
import PermissionsList from '../components/PermissionsList';

/** What Manhunt may use on this phone, reached from the home page */
function Settings()
{
    const navigate = useNavigate();

    return (
        <IonPage data-testid="settings-page">
            <IonHeader>
                <IonToolbar className="toolbar--back">
                    <IonButtons slot="start">
                        <IonButton data-testid="settings-back" onClick={() => navigate('/')}>
                            <IonIcon slot="start" icon={chevronBack} aria-hidden="true" />
                            Home
                        </IonButton>
                    </IonButtons>
                    <IonTitle>Settings</IonTitle>
                </IonToolbar>
            </IonHeader>
            <IonContent className="settings-page">
                <h3 className="settings-section">Permissions</h3>
                <PermissionsList />
                <p className="settings-note">
                    Once something is allowed, or blocked, only your phone’s own settings for Manhunt can change it.
                </p>
            </IonContent>
        </IonPage>
    );
}

export default Settings;
