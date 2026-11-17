import { IonModal, IonButton } from '@ionic/react';
import PermissionsList from './PermissionsList';
import { useRequiredPermissions } from '../hooks/usePermissions';

/**
 * "Before you play": what the game uses, asked for on entering a lobby in
 * the browser. Location and (on iPhones) the compass are needed to continue;
 * the rest is optional. (The installed app asks once when it first opens
 * instead: PermissionsSetup.)
 */
function PermissionsGate({ isOpen, onComplete, onNotificationsOn, onNotificationsOff })
{
    const { location, compass, ready } = useRequiredPermissions();

    return (
        <IonModal isOpen={isOpen} backdropDismiss={false} cssClass="permissions-dialog" data-testid="gate-modal">
            <div className="permissions-dialog-body">
                <h2>Before you play</h2>
                {/* Only the switches scroll: the title and button stay in view */}
                <div className="permissions-dialog-scroll">
                    <PermissionsList location={location} compass={compass} onNotificationsOn={onNotificationsOn} onNotificationsOff={onNotificationsOff} />
                </div>
                <IonButton data-testid="gate-continue" expand="block" disabled={!ready} onClick={onComplete}>
                    {ready ? 'Continue' : 'Allow what’s needed'}
                </IonButton>
            </div>
        </IonModal>
    );
}

export default PermissionsGate;
