import { useNavigate } from 'react-router-dom';
import {
    IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent,
    IonList, IonItem, IonLabel, IonToggle, IonSelect, IonSelectOption
} from '@ionic/react';
import { chevronBack } from 'ionicons/icons';
import { useTextSize, useReduceMotion } from '../utils/accessibility';
import { useKeepScreenOn, wakeLockSupported } from '../hooks/usePermissions';
import PermissionsList from '../components/PermissionsList';

const TEXT_SIZE_NAMES = { default: 'Default', large: 'Large', larger: 'Larger' };

/**
 * What the app may use on this phone, and how it looks and behaves, reached
 * from the home page. The permission switches show what's allowed and can ask
 * for what isn't; turning one off is the phone's own settings' to do, and a
 * tap on one that's on says so (PermissionsList).
 */
function Settings()
{
    const navigate = useNavigate();
    const [textSize, setTextSize] = useTextSize();
    const [reduceMotion, setReduceMotion] = useReduceMotion();
    const [keepScreenOn, setKeepScreenOn] = useKeepScreenOn();

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
                <PermissionsList showCamera />

                <h3 className="settings-section">Accessibility</h3>
                <IonList inset className="settings-list preference-list">
                    <IonItem>
                        <IonSelect
                            label="Text size"
                            data-testid="text-size"
                            interface="action-sheet"
                            value={textSize}
                            onIonChange={(e) => setTextSize(e.detail.value)}
                        >
                            {Object.entries(TEXT_SIZE_NAMES).map(([size, name]) => (
                                <IonSelectOption key={size} value={size}>{name}</IonSelectOption>
                            ))}
                        </IonSelect>
                    </IonItem>
                    <IonItem>
                        <IonLabel>
                            <h2>Reduce motion</h2>
                            <p>Less movement on screen</p>
                        </IonLabel>
                        <IonToggle
                            slot="end"
                            aria-label="Reduce motion"
                            data-testid="toggle-reduce-motion"
                            checked={reduceMotion}
                            onIonChange={(e) => setReduceMotion(e.detail.checked)}
                        />
                    </IonItem>
                </IonList>

                {/* Only where a page can keep the screen on. The native apps
                    can't, and don't need to: they carry on with it off */}
                {wakeLockSupported() && (
                    <>
                        <h3 className="settings-section">During a game</h3>
                        <IonList inset className="settings-list preference-list">
                            <IonItem>
                                <IonLabel>
                                    <h2>Keep screen on</h2>
                                    <p>The game stops updating when the screen goes off</p>
                                </IonLabel>
                                <IonToggle
                                    slot="end"
                                    aria-label="Keep screen on"
                                    data-testid="toggle-wake"
                                    checked={keepScreenOn}
                                    onIonChange={(e) => setKeepScreenOn(e.detail.checked)}
                                />
                            </IonItem>
                        </IonList>
                    </>
                )}
            </IonContent>
        </IonPage>
    );
}

export default Settings;
