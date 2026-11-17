import { IonAlert } from '@ionic/react';
import { useInstallOffer, dismissInstallOffer, installApp } from '../utils/install';

const WHY = 'It opens full screen like an app, and can tell you when players are found.';

// What to do, for each way this browser installs (src/utils/install.js)
const HOW = {
    prompt: '',
    ios: ' Tap the Share button, then Add to Home Screen.',
    menu: ' Open your browser’s menu and choose Add to Home screen (or Install app).'
};

/** The first-visit offer to add Manhunt to the Home Screen */
function InstallOffer()
{
    const { status, kind } = useInstallOffer();

    return (
        <IonAlert
            isOpen={status === 'open'}
            cssClass="install-alert"
            header="Add Manhunt to your Home Screen"
            message={WHY + (HOW[kind] ?? '')}
            buttons={kind === 'prompt'
                ? [{ text: 'Not now', role: 'cancel' }, { text: 'Install', handler: () => { installApp(); } }]
                : [{ text: 'Got it', role: 'cancel' }]}
            onDidDismiss={dismissInstallOffer}
        />
    );
}

export default InstallOffer;
