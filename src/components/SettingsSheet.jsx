import { useState } from 'react';
import {
    IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
    IonList, IonItem, IonLabel, IonToggle, IonRange, IonSelect, IonSelectOption, IonNote, IonToast
} from '@ionic/react';
import { formatDistance } from '../utils/geo';
import { formatDuration } from '../utils/game';

const TIME_LIMITS_MIN = [0, 10, 15, 20, 30, 45, 60, 90, 120];
const HEAD_STARTS_S = [0, 30, 60, 120, 180, 300];
const RADIUS = { min: 100, max: 2000, step: 50, default: 400 };

/**
 * Game settings. The host edits a draft and saves it; everyone else sees the
 * same sheet read-only. The server validates again regardless.
 */
function SettingsSheet({ isOpen, onClose, settings, isHost, canEdit, currentLocation, updateSettings })
{
    const [draft, setDraft] = useState(settings);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const editable = isHost && canEdit;
    const fence = draft?.geofence ?? null;
    const [radius, setRadius] = useState(RADIUS.default);
    const fenceOn = fence !== null;
    const hasFix = currentLocation?.latitude != null;

    // Start each opening from what the lobby currently has
    const handleWillPresent = () =>
    {
        setDraft(settings);
        setRadius(settings?.geofence?.radius_m ?? RADIUS.default);
    };

    const centreHere = () => ({ latitude: currentLocation.latitude, longitude: currentLocation.longitude, radius_m: radius });

    function toggleFence(on)
    {
        // The centre needs a GPS fix; without one the area stays off
        if (on && !hasFix) return setError('Waiting for your location. Try again in a moment.');
        setDraft((d) => ({ ...d, geofence: on ? centreHere() : null }));
    }

    function changeRadius(value)
    {
        setRadius(value);
        setDraft((d) => (d.geofence ? { ...d, geofence: { ...d.geofence, radius_m: value } } : d));
    }

    async function save()
    {
        setIsSaving(true);
        try {
            await updateSettings(draft);
            onClose();
        } catch (err) {
            setError(err.status === 'network_error'
                ? "Couldn't reach the server. Check your connection and try again."
                : err.message || "Couldn't save the settings.");
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <IonModal isOpen={isOpen} onWillPresent={handleWillPresent} onDidDismiss={onClose} data-testid="settings-sheet">
            <IonHeader>
                <IonToolbar>
                    <IonButtons slot="start">
                        <IonButton data-testid="settings-cancel" onClick={onClose}>{editable ? 'Cancel' : 'Close'}</IonButton>
                    </IonButtons>
                    <IonTitle>Game settings</IonTitle>
                    {editable && (
                        <IonButtons slot="end">
                            <IonButton data-testid="settings-save" className="toolbar-primary" disabled={isSaving} onClick={save}>
                                {isSaving ? 'Saving…' : 'Save'}
                            </IonButton>
                        </IonButtons>
                    )}
                </IonToolbar>
            </IonHeader>

            <IonContent className="ion-padding settings-content">
                {!editable && (
                    <p className="settings-note">
                        {isHost ? 'Settings are fixed once the game starts' : 'Only the host can change these'}
                    </p>
                )}

                <h3 className="settings-section">Play area</h3>
                <IonList inset className="settings-list">
                    <IonItem>
                        <IonLabel>
                            <h2>Limit the play area</h2>
                            <p>A circle around where you are now</p>
                        </IonLabel>
                        <IonToggle
                            slot="end"
                            aria-label="Limit the play area"
                            data-testid="fence-toggle"
                            checked={fenceOn}
                            disabled={!editable}
                            onIonChange={(e) => toggleFence(e.detail.checked)}
                        />
                    </IonItem>
                    {fenceOn && (
                        <>
                            <IonItem>
                                <IonLabel>
                                    <h2>Radius</h2>
                                </IonLabel>
                                <IonNote slot="end" className="settings-value" data-testid="fence-radius">
                                    {formatDistance(fence.radius_m)}
                                </IonNote>
                            </IonItem>
                            <IonItem>
                                <IonRange
                                    aria-label="Play area radius"
                                    data-testid="fence-range"
                                    min={RADIUS.min}
                                    max={RADIUS.max}
                                    step={RADIUS.step}
                                    value={fence.radius_m}
                                    disabled={!editable}
                                    onIonInput={(e) => changeRadius(e.detail.value)}
                                />
                            </IonItem>
                            {editable && (
                                <IonItem button detail={false} disabled={!hasFix} onClick={() => setDraft((d) => ({ ...d, geofence: centreHere() }))}>
                                    <IonLabel>
                                        <h2>Re-centre on me</h2>
                                        <p>Use your current position as the middle</p>
                                    </IonLabel>
                                </IonItem>
                            )}
                        </>
                    )}
                </IonList>

                <h3 className="settings-section">Timing</h3>
                <IonList inset className="settings-list">
                    <IonItem>
                        <IonSelect
                            label="Time limit"
                            data-testid="time-limit"
                            interface="action-sheet"
                            value={(draft?.time_limit_s ?? 0) / 60}
                            disabled={!editable}
                            onIonChange={(e) => setDraft((d) => ({ ...d, time_limit_s: e.detail.value * 60 }))}
                        >
                            {TIME_LIMITS_MIN.map((m) => (
                                <IonSelectOption key={m} value={m}>{formatDuration(m * 60, 'No limit')}</IonSelectOption>
                            ))}
                        </IonSelect>
                    </IonItem>
                    <IonItem>
                        <IonSelect
                            label="Head start"
                            data-testid="head-start"
                            interface="action-sheet"
                            value={draft?.head_start_s ?? 0}
                            disabled={!editable}
                            onIonChange={(e) => setDraft((d) => ({ ...d, head_start_s: e.detail.value }))}
                        >
                            {HEAD_STARTS_S.map((s) => (
                                <IonSelectOption key={s} value={s}>{formatDuration(s)}</IonSelectOption>
                            ))}
                        </IonSelect>
                    </IonItem>
                </IonList>
                <p className="settings-note">
                    Seekers wait out the head start. The time limit starts when they set off, and the
                    hiders win if it runs out.
                </p>

                <IonToast isOpen={!!error} message={error} duration={4000} onDidDismiss={() => setError('')} />
            </IonContent>
        </IonModal>
    );
}

export default SettingsSheet;
