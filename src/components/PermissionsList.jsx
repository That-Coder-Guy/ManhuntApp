import { IonList, IonItem, IonLabel, IonToggle, IonNote } from '@ionic/react';
import {
    useLocationPermission, useNotificationPermission, useCompassPermission, useKeepScreenOn, wakeLockSupported
} from '../hooks/usePermissions';

const STATUS_LABELS = {
    prompt: 'Off',
    requesting: 'Asking…',
    granted: 'On',
    denied: 'Blocked · allow it in your phone’s settings for Manhunt',
    unsupported: 'Not available on this device',
    install: 'Only in the Home Screen app',
};

function PermissionRow({ id, title, requirement, description, status, onToggle, checked = status === 'granted', disabled })
{
    return (
        <IonItem>
            <IonLabel>
                <h3>{title} <IonNote className="permission-requirement">{requirement}</IonNote></h3>
                <p>{description}</p>
                <IonNote className="permission-status" data-testid={`${id}-status`}>{STATUS_LABELS[status] ?? status}</IonNote>
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
 * popup, and the Settings page. `location` lets the caller share its own
 * location state; `onNotificationsOn` runs once notifications are allowed.
 */
function PermissionsList({ location, onNotificationsOn })
{
    const ownLocation = useLocationPermission();
    const [locationStatus, requestLocation] = location ?? ownLocation;
    const [notifyStatus, askNotifications] = useNotificationPermission();
    const requestNotifications = async () =>
    {
        if (await askNotifications() === 'granted') onNotificationsOn?.();
    };
    const [compassStatus, requestCompass] = useCompassPermission();
    const [keepScreenOn, setKeepScreenOn] = useKeepScreenOn();
    const canKeepOn = wakeLockSupported();

    return (
        <IonList inset className="permission-list">
            <PermissionRow
                id="location"
                title="Location"
                requirement="Needed to play"
                description="Shows distances and directions to other players"
                status={locationStatus}
                // A refusal can't be asked again from here; the phone's settings can
                disabled={locationStatus !== 'prompt'}
                onToggle={requestLocation}
            />
            {notifyStatus !== 'unsupported' && (
                <PermissionRow
                    id="notify"
                    title="Notifications"
                    requirement="Optional"
                    description="Tells you when players are found, even with your phone locked"
                    status={notifyStatus}
                    disabled={notifyStatus !== 'prompt'}
                    onToggle={requestNotifications}
                />
            )}
            {compassStatus !== 'unsupported' && (
                <PermissionRow
                    id="compass"
                    title="Compass"
                    requirement="Optional"
                    description="Turns the arrow with your phone, so it points the way to go"
                    status={compassStatus}
                    onToggle={requestCompass}
                />
            )}
            <PermissionRow
                id="wake"
                title="Keep screen on"
                requirement="Optional"
                description="Stops your screen sleeping during a game"
                status={!canKeepOn ? 'unsupported' : keepScreenOn ? 'granted' : 'prompt'}
                checked={canKeepOn && keepScreenOn}
                disabled={!canKeepOn}
                onToggle={() => setKeepScreenOn(!keepScreenOn)}
            />
        </IonList>
    );
}

export default PermissionsList;
