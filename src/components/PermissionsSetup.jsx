import { IonModal, IonButton } from '@ionic/react';
import PermissionsList from './PermissionsList';
import { useSetupNeeded, finishSetup } from '../hooks/usePermissions';

/**
 * The installed app's first-open popup: everything it may use, asked for in
 * one place. Shown once; the same switches stay on the Settings page.
 */
function PermissionsSetup()
{
    const isOpen = useSetupNeeded();

    return (
        <IonModal isOpen={isOpen} backdropDismiss={false} cssClass="permissions-dialog" data-testid="setup-modal">
            <div className="permissions-dialog-body">
                <h2>Set up Manhunt</h2>
                <p className="permissions-dialog-intro">
                    Turn on what the game can use. You can change these any time in Settings on the home page.
                </p>
                <PermissionsList />
                <IonButton data-testid="setup-done" expand="block" onClick={finishSetup}>Done</IonButton>
            </div>
        </IonModal>
    );
}

export default PermissionsSetup;
