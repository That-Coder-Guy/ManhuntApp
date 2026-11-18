import { IonModal, IonButton } from '@ionic/react';
import PermissionsList from './PermissionsList';

/**
 * "Before you play": what the game uses, asked for on entering a lobby.
 * Location and (on iPhones) the compass are needed to continue; the rest is
 * optional. The browser shows it on the way into every lobby; the installed
 * app, which offered the same when it first opened (PermissionsSetup), shows
 * it only when one of the needed ones is still missing. `permissions` is the
 * lobby's own useRequiredPermissions. There is always a way out: `onLeave`
 * leaves the lobby instead.
 */
function PermissionsGate({ isOpen, permissions, onComplete, onLeave, onNotificationsOn })
{
    const { location, compass, ready } = permissions;

    return (
        <IonModal isOpen={isOpen} backdropDismiss={false} cssClass="permissions-dialog" data-testid="gate-modal">
            <div className="permissions-dialog-body">
                <h2>Before you play</h2>
                {/* Only the switches scroll: the title and buttons stay in view */}
                <div className="permissions-dialog-scroll">
                    <PermissionsList location={location} compass={compass} onNotificationsOn={onNotificationsOn} />
                </div>
                <IonButton data-testid="gate-continue" expand="block" disabled={!ready} onClick={onComplete}>
                    {ready ? 'Continue' : 'Allow what’s needed'}
                </IonButton>
                <IonButton data-testid="gate-leave" expand="block" fill="clear" className="permissions-dialog-secondary" onClick={onLeave}>
                    Leave lobby
                </IonButton>
            </div>
        </IonModal>
    );
}

export default PermissionsGate;
