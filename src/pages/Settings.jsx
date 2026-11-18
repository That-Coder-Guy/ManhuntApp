import { useNavigate } from 'react-router-dom';
import {
    IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent,
    IonList, IonItem, IonLabel, IonToggle, IonSelect, IonSelectOption
} from '@ionic/react';
import { chevronBack } from 'ionicons/icons';
import { useTextSize, useReduceMotion } from '../utils/accessibility';
import { useKeepScreenOn, wakeLockSupported } from '../hooks/usePermissions';

const TEXT_SIZE_NAMES = { default: 'Default', large: 'Large', larger: 'Larger' };

/**
 * How the app looks and behaves on this phone, reached from the home page.
 * What the app may use (location, notifications, the camera) isn't here: it
 * is asked for once, when it's first needed (PermissionsSetup,
 * PermissionsGate), and after that only the phone's own settings can change it.
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
