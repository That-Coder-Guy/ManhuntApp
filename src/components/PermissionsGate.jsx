import { useEffect, useState } from 'react';
import {
    IonModal, IonList, IonItem, IonLabel, IonToggle,
    IonNote, IonButton
} from '@ionic/react';

const STATUS_LABELS = {
    prompt: 'Pending',
    requesting: 'Requesting…',
    granted: 'Granted',
    denied: 'Denied',
    unsupported: 'Unsupported',
};

function PermissionsGate({
    isOpen,
    onComplete,
    requestWakeLock,
    isWakeLockSupported,
    isWakeLockActive,
}) {
    const isBrowser = typeof window !== 'undefined';
    const isLocationSupported = isBrowser && 'geolocation' in navigator;

    const [locationStatus, setLocationStatus] = useState('prompt');
    const [wakeLockStatus, setWakeLockStatus] = useState(
        isWakeLockSupported ? 'prompt' : 'unsupported'
    );
    const [isContinuing, setIsContinuing] = useState(false);

    useEffect(() => {
        if (!isBrowser) {
            return;
        }

        let geoPermissionStatus;
        let cancelled = false;

        function applyGeolocationState(state) {
            if (cancelled) return;

            if (state === 'granted') {
                setLocationStatus('granted');
            } else if (state === 'denied') {
                setLocationStatus('denied');
            } else {
                setLocationStatus('prompt');
            }
        }

        if (isLocationSupported && navigator.permissions?.query) {
            navigator.permissions
                .query({ name: 'geolocation' })
                .then((status) => {
                    if (cancelled) return;
                    geoPermissionStatus = status;
                    applyGeolocationState(status.state);
                    status.onchange = () => applyGeolocationState(status.state);
                })
                .catch(() => {
                    if (navigator.geolocation) {
                        navigator.geolocation.getCurrentPosition(
                            () => applyGeolocationState('granted'),
                            () => applyGeolocationState('denied')
                        );
                    }
                });
        } else if (!isLocationSupported) {
            setLocationStatus('unsupported');
        }

        return () => {
            cancelled = true;
            if (geoPermissionStatus) {
                geoPermissionStatus.onchange = null;
            }
        };
    }, [isBrowser, isLocationSupported]);

    useEffect(() => {
        if (!isWakeLockSupported) {
            setWakeLockStatus('unsupported');
        }
    }, [isWakeLockSupported]);

    useEffect(() => {
        if (!isWakeLockSupported) {
            return;
        }

        if (isWakeLockActive) {
            setWakeLockStatus('granted');
        } else if (wakeLockStatus === 'granted') {
            setWakeLockStatus('prompt');
        }
    }, [isWakeLockSupported, isWakeLockActive, wakeLockStatus]);

    const locationGranted = locationStatus === 'granted';
    const wakeLockGranted = !isWakeLockSupported || wakeLockStatus === 'granted';

    // Location is required (distances/directions depend on it); keep-screen-on
    // is a recommended convenience and must never block starting the game.
    const canContinue = locationGranted;

    const handleLocationToggle = () => {
        if (!isLocationSupported) {
            setLocationStatus('unsupported');
            return;
        }
        if (locationStatus === 'requesting' || locationStatus === 'granted') {
            return;
        }

        setLocationStatus('requesting');
        navigator.geolocation.getCurrentPosition(
            () => setLocationStatus('granted'),
            () => setLocationStatus('denied'),
            { enableHighAccuracy: true, maximumAge: 10_000, timeout: 10_000 }
        );
    };

    const handleWakeLockToggle = async () => {
        if (!isWakeLockSupported) {
            setWakeLockStatus('unsupported');
            return;
        }
        if (wakeLockStatus === 'requesting' || wakeLockStatus === 'granted') {
            return;
        }

        setWakeLockStatus('requesting');
        try {
            await requestWakeLock();
            setWakeLockStatus('granted');
        } catch (error) {
            console.error('[Permissions] Wake lock request failed:', error);
            setWakeLockStatus('denied');
        }
    };

    const handleContinue = () => {
        if (!canContinue || isContinuing) {
            return;
        }
        setIsContinuing(true);
        onComplete();
    };

    // Reset the continue latch when the gate reopens
    useEffect(() => {
        if (isOpen) setIsContinuing(false);
    }, [isOpen]);

    return (
        <IonModal
            isOpen={isOpen}
            backdropDismiss={false}
            cssClass="permissions-dialog"
            data-testid="gate-modal"
        >
            <div className="permissions-dialog-body">
                <h2>Enable Permissions</h2>

                <IonList inset>
                    <IonItem>
                        <IonLabel>
                            <h3>Location <IonNote color="danger">(required)</IonNote></h3>
                            <p>Needed to show distances and directions to other players.</p>
                            <IonNote data-testid="location-status">
                                {STATUS_LABELS[locationStatus] || locationStatus}
                            </IonNote>
                        </IonLabel>
                        <IonToggle
                            slot="end"
                            data-testid="toggle-location"
                            aria-label="Enable location"
                            checked={locationGranted}
                            disabled={
                                locationGranted ||
                                locationStatus === 'requesting' ||
                                locationStatus === 'unsupported'
                            }
                            onClick={handleLocationToggle}
                        />
                    </IonItem>

                    <IonItem>
                        <IonLabel>
                            <h3>Keep screen on <IonNote>(optional)</IonNote></h3>
                            <p>Stops your screen sleeping while you play.</p>
                            <IonNote data-testid="wake-status">
                                {STATUS_LABELS[wakeLockStatus] || wakeLockStatus}
                            </IonNote>
                        </IonLabel>
                        <IonToggle
                            slot="end"
                            data-testid="toggle-wake"
                            aria-label="Keep screen on"
                            checked={wakeLockGranted && isWakeLockSupported}
                            disabled={
                                wakeLockStatus === 'requesting' ||
                                wakeLockStatus === 'unsupported' ||
                                !isWakeLockSupported
                            }
                            onClick={handleWakeLockToggle}
                        />
                    </IonItem>
                </IonList>

                <IonButton
                    data-testid="gate-continue"
                    expand="block"
                    className="ion-margin-top"
                    disabled={!canContinue || isContinuing}
                    onClick={handleContinue}
                >
                    {canContinue ? 'Continue' : 'Waiting for permissions'}
                </IonButton>
            </div>
        </IonModal>
    );
}

export default PermissionsGate;
