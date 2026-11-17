import { IonModal, IonButton } from '@ionic/react';
import PermissionsList from './PermissionsList';
import { useLocationPermission } from '../hooks/usePermissions';

/**
 * "Before you play": what the game uses, asked for on entering a lobby in
 * the browser. Location is needed to continue; the rest is optional. (The
 * installed app asks once when it first opens instead: PermissionsSetup.)
 */
function PermissionsGate({ isOpen, onComplete, onNotificationsOn })
{
    const location = useLocationPermission();
    const canContinue = location[0] === 'granted';

    return (
        <IonModal isOpen={isOpen} backdropDismiss={false} cssClass="permissions-dialog" data-testid="gate-modal">
            <div className="permissions-dialog-body">
                <h2>Before you play</h2>
                <PermissionsList location={location} onNotificationsOn={onNotificationsOn} />
                <IonButton data-testid="gate-continue" expand="block" disabled={!canContinue} onClick={onComplete}>
                    {canContinue ? 'Continue' : 'Allow location to continue'}
                </IonButton>
            </div>
        </IonModal>
    );
}

export default PermissionsGate;
