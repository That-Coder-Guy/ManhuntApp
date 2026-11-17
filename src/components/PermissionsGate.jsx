import { useEffect, useState } from 'react';
import { IonModal, IonList, IonItem, IonLabel, IonToggle, IonNote, IonButton } from '@ionic/react';
import { pushStatus, enablePush } from '../utils/push';

const STATUS_LABELS = {
    prompt: 'Off',
    requesting: 'Asking…',
    granted: 'On',
    denied: 'Blocked',
    unsupported: 'Not available on this device',
};

const LOCATION_DENIED_HELP = 'Blocked · allow location for this site in your browser settings';

const NOTIFICATION_HELP = {
    denied: 'Blocked · allow notifications for this site in your settings',
    install: 'On iPhone, add Manhunt to your Home Screen first (Share → Add to Home Screen)',
};

/**
 * Notifications as 'prompt' | 'requesting' | 'granted' | 'denied' |
 * 'unsupported' | 'install'. Turning them on asks permission straight from the
 * tap (iOS only allows it then), subscribes, and hands the server the result.
 */
function useNotifications(pushKey, onPushEnabled)
{
    const [status, setStatus] = useState(pushStatus);

    const request = async () =>
    {
        if (!pushKey || status !== 'prompt') return;
        setStatus('requesting');
        try {
            // Called first, in the tap itself
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return setStatus(permission === 'denied' ? 'denied' : 'prompt');
            await onPushEnabled(await enablePush(pushKey));
            setStatus('granted');
        } catch (error) {
            console.warn('[Permissions] Notifications failed:', error);
            setStatus(pushStatus() === 'granted' ? 'prompt' : pushStatus());
        }
    };

    return [status, request];
}

const hasGeolocation = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;

/** Location permission as 'prompt' | 'requesting' | 'granted' | 'denied' | 'unsupported' */
function useLocationPermission()
{
    const [status, setStatus] = useState(() => (hasGeolocation() ? 'prompt' : 'unsupported'));

    // Reflect the browser's current answer, and follow changes made in settings
    useEffect(() =>
    {
        if (!hasGeolocation() || !navigator.permissions?.query) return undefined;

        let permission;
        let cancelled = false;
        const apply = (state) => { if (!cancelled) setStatus(state === 'granted' || state === 'denied' ? state : 'prompt'); };

        navigator.permissions.query({ name: 'geolocation' })
            .then((result) =>
            {
                permission = result;
                apply(result.state);
                result.onchange = () => apply(result.state);
            })
            .catch(() => { /* older browsers: stay on 'prompt' until the player taps */ });

        return () =>
        {
            cancelled = true;
            if (permission) permission.onchange = null;
        };
    }, []);

    const request = () =>
    {
        if (!hasGeolocation() || status === 'requesting' || status === 'granted') return;
        setStatus('requesting');
        navigator.geolocation.getCurrentPosition(
            () => setStatus('granted'),
            () => setStatus('denied'),
            { enableHighAccuracy: true, maximumAge: 10_000, timeout: 10_000 }
        );
    };

    return [status, request];
}

function PermissionsGate({ isOpen, onComplete, requestWakeLock, isWakeLockSupported, isWakeLockActive, pushKey = null, onPushEnabled = async () => {} })
{
    const [locationStatus, requestLocation] = useLocationPermission();
    const [notifyStatus, requestNotifications] = useNotifications(pushKey, onPushEnabled);
    // Only the request's own progress is local; "on" comes from the hook
    const [wakeRequest, setWakeRequest] = useState('idle');

    const wakeStatus = !isWakeLockSupported ? 'unsupported'
        : isWakeLockActive ? 'granted'
        : wakeRequest === 'idle' ? 'prompt'
        : wakeRequest;

    const handleWakeLockToggle = async () =>
    {
        if (!isWakeLockSupported || isWakeLockActive || wakeRequest === 'requesting') return;
        setWakeRequest('requesting');
        try {
            await requestWakeLock();
            setWakeRequest('idle');
        } catch (error) {
            console.warn('[Permissions] Wake lock request failed:', error);
            setWakeRequest('denied');
        }
    };

    // Location is required (distances and directions depend on it); keeping
    // the screen on is a convenience and never blocks starting the game
    const canContinue = locationStatus === 'granted';

    return (
        <IonModal isOpen={isOpen} backdropDismiss={false} cssClass="permissions-dialog" data-testid="gate-modal">
            <div className="permissions-dialog-body">
                <h2>Before you play</h2>

                <IonList inset>
                    <IonItem>
                        <IonLabel>
                            <h3>Location <IonNote className="permission-requirement">Required</IonNote></h3>
                            <p>Shows distances and directions to other players</p>
                            <IonNote className="permission-status" data-testid="location-status">
                                {locationStatus === 'denied' ? LOCATION_DENIED_HELP : STATUS_LABELS[locationStatus]}
                            </IonNote>
                        </IonLabel>
                        <IonToggle
                            slot="end"
                            data-testid="toggle-location"
                            aria-label="Enable location"
                            checked={locationStatus === 'granted'}
                            disabled={['granted', 'requesting', 'unsupported'].includes(locationStatus)}
                            onClick={requestLocation}
                        />
                    </IonItem>

                    <IonItem>
                        <IonLabel>
                            <h3>Keep screen on <IonNote className="permission-requirement">Optional</IonNote></h3>
                            <p>Stops your screen sleeping while you play</p>
                            <IonNote className="permission-status" data-testid="wake-status">
                                {STATUS_LABELS[wakeStatus]}
                            </IonNote>
                        </IonLabel>
                        <IonToggle
                            slot="end"
                            data-testid="toggle-wake"
                            aria-label="Keep screen on"
                            checked={wakeStatus === 'granted'}
                            disabled={wakeStatus === 'unsupported' || wakeStatus === 'requesting'}
                            onClick={handleWakeLockToggle}
                        />
                    </IonItem>

                    {/* Only when this server sends notifications */}
                    {pushKey && (
                        <IonItem>
                            <IonLabel>
                                <h3>Notifications <IonNote className="permission-requirement">Optional</IonNote></h3>
                                <p>Tells you when players are found, even with your phone locked</p>
                                <IonNote className="permission-status" data-testid="notify-status">
                                    {NOTIFICATION_HELP[notifyStatus] ?? STATUS_LABELS[notifyStatus]}
                                </IonNote>
                            </IonLabel>
                            <IonToggle
                                slot="end"
                                data-testid="toggle-notify"
                                aria-label="Turn on notifications"
                                checked={notifyStatus === 'granted'}
                                disabled={notifyStatus !== 'prompt'}
                                onClick={requestNotifications}
                            />
                        </IonItem>
                    )}
                </IonList>

                <IonButton
                    data-testid="gate-continue"
                    expand="block"
                    className="ion-margin-top"
                    disabled={!canContinue}
                    onClick={onComplete}
                >
                    {canContinue ? 'Continue' : 'Allow location to continue'}
                </IonButton>
            </div>
        </IonModal>
    );
}

export default PermissionsGate;
