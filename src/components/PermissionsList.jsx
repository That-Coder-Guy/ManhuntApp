import { IonList, IonItem, IonLabel, IonToggle, IonNote } from '@ionic/react';
import {
    useLocationPermission, useNotificationPermission, useCompassPermission, useCameraPermission, useKeepScreenOn, wakeLockSupported
} from '../hooks/usePermissions';

const STATUS_LABELS = {
    prompt: 'Off',
    off: 'Off',
    requesting: 'Asking…',
    granted: 'On',
    denied: 'Blocked · allow it in phone settings',
    unsupported: 'Not available on this device',
    install: 'Only in the Home Screen app',
};

// iPhones forget a compass refusal when the app or page starts again
const COMPASS_DENIED = 'Blocked · reopen Manhunt to be asked again';

function PermissionRow({ id, title, requirement, description, status, statusText, onToggle, checked = status === 'granted', disabled })
{
    return (
        <IonItem>
            <IonLabel>
                <h3>{title} <IonNote className="permission-requirement">{requirement}</IonNote></h3>
                <p>{description}</p>
                <IonNote className="permission-status" data-testid={`${id}-status`}>{statusText ?? STATUS_LABELS[status] ?? status}</IonNote>
            </IonLabel>
            <IonToggle
                slot="end"
                data-testid={`toggle-${id}`}
                aria-label={title}
                checked={checked}
                // Once allowed, only the phone's own settings can take it back
                disabled={disabled ?? !['prompt', 'denied'].includes(status)}
                onClick={onToggle}
            />
        </IonItem>
    );
}

/**
 * Everything Manhunt may use on this phone, each with a switch that asks for
 * it: "Before you play" in the browser, the installed app's first-open
 * popup, and the Settings page. `location` and `compass` let the caller
 * share its own state for those (the required ones: useRequiredPermissions);
 * `onNotificationsOn` / `onNotificationsOff` run when notifications are
 * turned on or off. `showCamera` adds the camera (for scanning join codes),
 * which matters outside a lobby: the installed app's popup and Settings.
 */
function PermissionsList({ location, compass, onNotificationsOn, onNotificationsOff, showCamera = false })
{
    const ownLocation = useLocationPermission();
    const ownCompass = useCompassPermission();
    const [locationStatus, requestLocation] = location ?? ownLocation;
    const [compassStatus, requestCompass] = compass ?? ownCompass;
    const [notifyStatus, toggleNotificationsState] = useNotificationPermission();
    const toggleNotifications = async () =>
    {
        const next = await toggleNotificationsState();
        if (next === 'granted') onNotificationsOn?.();
        if (next === 'off') onNotificationsOff?.();
    };
    const [cameraStatus, requestCamera] = useCameraPermission();
    const [keepScreenOn, setKeepScreenOn] = useKeepScreenOn();
    const canKeepOn = wakeLockSupported();

    return (
        <IonList inset className="permission-list">
            <PermissionRow
                id="location"
                title="Location"
                requirement="Required"
                description="How far away players are"
                status={locationStatus}
                // A refusal can't be asked again from here; the phone's settings can
                disabled={locationStatus !== 'prompt'}
                onToggle={requestLocation}
            />
            {compassStatus !== 'unsupported' && (
                <PermissionRow
                    id="compass"
                    title="Compass"
                    requirement="Required"
                    description="Points the arrow the right way"
                    status={compassStatus}
                    statusText={compassStatus === 'denied' ? COMPASS_DENIED : undefined}
                    onToggle={requestCompass}
                />
            )}
            {/* Required ones first, then the optional ones */}
            {notifyStatus !== 'unsupported' && (
                <PermissionRow
                    id="notify"
                    title="Notifications"
                    requirement="Optional"
                    description="When players are found"
                    status={notifyStatus}
                    // Optional, so it turns off again (and back on without asking)
                    disabled={!['prompt', 'granted', 'off'].includes(notifyStatus)}
                    onToggle={toggleNotifications}
                />
            )}
            {showCamera && cameraStatus !== 'unsupported' && (
                <PermissionRow
                    id="camera"
                    title="Camera"
                    requirement="Optional"
                    description="For scanning join codes"
                    status={cameraStatus}
                    // Only a head start for the scanner: a page can't give the camera back
                    disabled={cameraStatus !== 'prompt'}
                    onToggle={requestCamera}
                />
            )}
            <PermissionRow
                id="wake"
                title="Keep screen on"
                requirement="Optional"
                description="During a game"
                status={!canKeepOn ? 'unsupported' : keepScreenOn ? 'granted' : 'prompt'}
                checked={canKeepOn && keepScreenOn}
                disabled={!canKeepOn}
                onToggle={() => setKeepScreenOn(!keepScreenOn)}
            />
        </IonList>
    );
}

export default PermissionsList;
