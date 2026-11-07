import { useRef, useState } from 'react';
import {
    IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
    IonList, IonItem, IonLabel, IonToggle, IonSelect, IonSelectOption, IonToast
} from '@ionic/react';
import PlayAreaMap from './PlayAreaMap';
import { formatDuration, formatArea } from '../utils/game';
import { polygonArea, polygonProblem, POLYGON_LIMITS } from '../../shared/geofence.js';

const TIME_LIMITS_MIN = [0, 10, 15, 20, 30, 45, 60, 90, 120];
const HEAD_STARTS_S = [0, 30, 60, 120, 180, 300];

/**
 * Game settings. The host edits a draft and saves it; everyone else sees the
 * same sheet read-only. The server validates again regardless.
 */
function SettingsSheet({ isOpen, onClose, settings, isHost, canEdit, currentLocation, updateSettings })
{
    const [draft, setDraft] = useState(settings);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const mapRef = useRef(null);
    // Each corner change is kept, so Undo can step back through them
    const [history, setHistory] = useState([]);

    const editable = isHost && canEdit;
    const fence = draft?.geofence ?? null;
    const fenceOn = fence !== null;
    const points = fence?.points ?? [];
    const hasFix = currentLocation?.latitude != null;
    const problem = fenceOn ? polygonProblem(points) : null;

    // Start each opening from what the lobby currently has
    const handleWillPresent = () =>
    {
        setDraft(settings);
        setHistory([]);
    };

    function setPoints(next)
    {
        setHistory((h) => [...h, points]);
        setDraft((d) => ({ ...d, geofence: { points: next } }));
    }

    const undo = () =>
    {
        if (!history.length) return;
        setDraft((d) => ({ ...d, geofence: { points: history[history.length - 1] } }));
        setHistory((h) => h.slice(0, -1));
    };

    function toggleFence(on)
    {
        setHistory([]);
        // Turning it back on restores the lobby's saved area, if there was one
        setDraft((d) => ({ ...d, geofence: on ? (settings?.geofence ?? { points: [] }) : null }));
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
                            <IonButton data-testid="settings-save" className="toolbar-primary" disabled={isSaving || !!problem} onClick={save}>
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
                            <p>{editable ? 'Draw it on the map: tap to place corners' : 'Players outside it are flagged'}</p>
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
                </IonList>

                {fenceOn && (
                    <div className="play-area-editor" data-testid="play-area-editor">
                        <PlayAreaMap
                            ref={mapRef}
                            points={points}
                            onChange={setPoints}
                            editable={editable}
                            you={currentLocation}
                            maxCorners={POLYGON_LIMITS.maxCorners}
                        />
                        <p className={`play-area-status${problem && points.length ? ' play-area-status--problem' : ''}`} data-testid="play-area-status">
                            {problem
                                ? (points.length ? problem : 'Tap the map to place the first corner')
                                : `${points.length} corners · ${formatArea(polygonArea(points))}`}
                        </p>
                        <div className="play-area-tools">
                            {editable && (
                                <>
                                    <IonButton size="small" className="button-secondary" data-testid="fence-undo" disabled={!history.length} onClick={undo}>Undo</IonButton>
                                    <IonButton size="small" className="button-secondary" data-testid="fence-clear" disabled={!points.length} onClick={() => setPoints([])}>Clear</IonButton>
                                </>
                            )}
                            <IonButton size="small" className="button-secondary" data-testid="fence-me" disabled={!hasFix} onClick={() => mapRef.current?.centreOn(currentLocation)}>
                                Centre on me
                            </IonButton>
                        </div>
                        {editable && (
                            <p className="settings-note">Drag a corner to move it, tap it to remove it, or tap a hollow handle to add one between two corners.</p>
                        )}
                    </div>
                )}

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
