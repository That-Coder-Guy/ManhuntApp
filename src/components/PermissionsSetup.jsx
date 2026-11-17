import { IonModal, IonButton } from '@ionic/react';
import PermissionsList from './PermissionsList';
import { useRequiredPermissions, useSetupNeeded, finishSetup } from '../hooks/usePermissions';

/**
 * The installed app's first-open popup: everything it may use, asked for in
 * one place. Location and (on iPhones) the compass are needed to finish.
 * Shown once; the same switches stay on the Settings page.
 */
function PermissionsSetup()
{
    const isOpen = useSetupNeeded();
    const { location, compass, ready } = useRequiredPermissions();

    return (
        <IonModal isOpen={isOpen} backdropDismiss={false} cssClass="permissions-dialog" data-testid="setup-modal">
            <div className="permissions-dialog-body">
                <h2>Set up Manhunt</h2>
                <p className="permissions-dialog-intro">You can change these later in Settings.</p>
                {/* Only the switches scroll: the title and button stay in view */}
                <div className="permissions-dialog-scroll">
                    <PermissionsList location={location} compass={compass} />
                </div>
                <IonButton data-testid="setup-done" expand="block" disabled={!ready} onClick={finishSetup}>
                    {ready ? 'Done' : 'Allow what’s needed'}
                </IonButton>
            </div>
        </IonModal>
    );
}

export default PermissionsSetup;
