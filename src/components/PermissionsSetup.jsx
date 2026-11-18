import { IonModal, IonButton } from '@ionic/react';
import PermissionsList from './PermissionsList';
import { useRequiredPermissions, useSetupNeeded, finishSetup } from '../hooks/usePermissions';

/**
 * The installed app's permissions page: everything it may use, offered in
 * one place the first time the app opens. It can be put off: the app opens
 * without any of it, and what a game needs (location, and on iPhones the
 * compass) is insisted on where it's needed, on entering a lobby
 * (PermissionsGate). An app that won't open until it's given access isn't
 * allowed on the App Store, and has no reason to be here.
 */
function PermissionsSetup()
{
    const isOpen = useSetupNeeded();
    const { location, compass, ready } = useRequiredPermissions();

    return (
        <IonModal isOpen={isOpen} backdropDismiss={false} cssClass="permissions-dialog" data-testid="setup-modal">
            <div className="permissions-dialog-body">
                <h2>Set up Manhunt</h2>
                <p className="permissions-dialog-intro">
                    Joining a game needs the required ones: allow them now, or when you join. They’re all in Settings afterwards.
                </p>
                {/* Only the switches scroll: the title and button stay in view */}
                <div className="permissions-dialog-scroll">
                    <PermissionsList location={location} compass={compass} showCamera />
                </div>
                <IonButton data-testid="setup-done" expand="block" onClick={finishSetup}>
                    {ready ? 'Done' : 'Not now'}
                </IonButton>
            </div>
        </IonModal>
    );
}

export default PermissionsSetup;
