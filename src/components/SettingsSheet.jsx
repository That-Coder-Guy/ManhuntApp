import { useEffect, useRef, useState } from 'react';
import {
    IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
    IonList, IonItem, IonLabel, IonToggle, IonSelect, IonSelectOption, IonToast
} from '@ionic/react';
import PlayAreaMap from './PlayAreaMap';
import {
    formatDuration, formatArea, jamSettings, FOUND_RANGE_DEFAULT_M, SEEKER_INFO_DEFAULT, SEEKER_ALERT_DEFAULT_M, HIDER_BLUR_DEFAULT_M
} from '../utils/game';
import { polygonArea, polygonProblem, POLYGON_LIMITS } from '../../shared/geofence.js';

const TIME_LIMITS_MIN = [0, 10, 15, 20, 30, 45, 60, 90, 120];
const HEAD_STARTS_S = [0, 30, 60, 120, 180, 300];
const FOUND_RANGES_M = [10, 25, 50, 75, 100, 150, 200, 300];
const ALERT_DISTANCES_M = [25, 50, 75, 100, 150, 200, 300, 500];
// How far off a still hider is shown to seekers; 0 is always exact
const HIDER_BLURS_M = [0, 50, 100, 150, 200, 300];
const JAM_DURATIONS_S = [15, 30, 45, 60, 120, 180, 300];
const JAM_CHARGES_MIN = [1, 2, 5, 10, 15, 20, 30, 45, 60];

// What hiders learn about the seekers during a game
const SEEKER_INFO_OPTIONS = [
    { value: 'distance', label: 'Distance' },
    { value: 'nearby', label: 'Nearby alert' },
    { value: 'none', label: 'Nothing' },
];
const SEEKER_INFO_NOTES = {
    distance: 'Hiders see how far away the nearest seeker is, but not which way.',
    nearby: 'Hiders are only told when a seeker is within the alert distance, not how close or which way.',
    none: 'Hiders get no information about the seekers.',
};

/**
 * Game settings. The host edits a draft and saves it; everyone else sees the
 * same sheet read-only. The server validates again regardless.
 */
function SettingsSheet({ isOpen, onClose, settings, isHost, canEdit, currentLocation, onRequestLocation, updateSettings })
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

    // "Centre on me" before this phone has a position asks for one, then
    // centres when it arrives
    const [centreWhenFixed, setCentreWhenFixed] = useState(false);
    useEffect(() =>
    {
        if (!centreWhenFixed || !hasFix) return;
        mapRef.current?.centreOn(currentLocation);
        setCentreWhenFixed(false);
    }, [centreWhenFixed, hasFix, currentLocation]);

    function centreOnMe()
    {
        if (hasFix) return mapRef.current?.centreOn(currentLocation);
        setCentreWhenFixed(true);
        onRequestLocation?.();
    }
    const problem = fenceOn ? polygonProblem(points) : null;
    const seekerInfo = draft?.seeker_info ?? SEEKER_INFO_DEFAULT;
    const jam = jamSettings(draft);
    const hiderBlur = draft?.hider_blur_m ?? HIDER_BLUR_DEFAULT_M;

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
                            <IonButton size="small" className="button-secondary" data-testid="fence-me" disabled={!hasFix && !onRequestLocation} onClick={centreOnMe}>
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

                <h3 className="settings-section">Finding</h3>
                <IonList inset className="settings-list">
                    <IonItem>
                        <IonSelect
                            label="Found within"
                            data-testid="found-range"
                            interface="action-sheet"
                            value={draft?.found_range_m ?? FOUND_RANGE_DEFAULT_M}
                            disabled={!editable}
                            onIonChange={(e) => setDraft((d) => ({ ...d, found_range_m: e.detail.value }))}
                        >
                            {FOUND_RANGES_M.map((m) => (
                                <IonSelectOption key={m} value={m}>{`${m}\u202Fm`}</IonSelectOption>
                            ))}
                        </IonSelect>
                    </IonItem>
                </IonList>
                <p className="settings-note">
                    A hider can tap “I’ve been found” once a seeker is this close, and joins the
                    seekers. When everyone is found, the seekers win.
                </p>

                <h3 className="settings-section">Hiders see</h3>
                <IonList inset className="settings-list">
                    <IonItem>
                        <IonSelect
                            label="Seeker info"
                            data-testid="seeker-info-mode"
                            interface="action-sheet"
                            value={seekerInfo}
                            disabled={!editable}
                            onIonChange={(e) => setDraft((d) => ({ ...d, seeker_info: e.detail.value }))}
                        >
                            {SEEKER_INFO_OPTIONS.map(({ value, label }) => (
                                <IonSelectOption key={value} value={value}>{label}</IonSelectOption>
                            ))}
                        </IonSelect>
                    </IonItem>
                    {seekerInfo === 'nearby' && (
                        <IonItem>
                            <IonSelect
                                label="Alert within"
                                data-testid="seeker-alert"
                                interface="action-sheet"
                                value={draft?.seeker_alert_m ?? SEEKER_ALERT_DEFAULT_M}
                                disabled={!editable}
                                onIonChange={(e) => setDraft((d) => ({ ...d, seeker_alert_m: e.detail.value }))}
                            >
                                {ALERT_DISTANCES_M.map((m) => (
                                    <IonSelectOption key={m} value={m}>{`${m}\u202Fm`}</IonSelectOption>
                                ))}
                            </IonSelect>
                        </IonItem>
                    )}
                </IonList>
                <p className="settings-note" data-testid="seeker-info-note">{SEEKER_INFO_NOTES[seekerInfo]}</p>

                <h3 className="settings-section">Seekers see</h3>
                <IonList inset className="settings-list">
                    <IonItem>
                        <IonSelect
                            label="A still hider"
                            data-testid="hider-blur"
                            interface="action-sheet"
                            value={hiderBlur}
                            disabled={!editable}
                            onIonChange={(e) => setDraft((d) => ({ ...d, hider_blur_m: e.detail.value }))}
                        >
                            {HIDER_BLURS_M.map((m) => (
                                <IonSelectOption key={m} value={m}>{m ? `Within ${m}\u202Fm` : 'Exactly'}</IonSelectOption>
                            ))}
                        </IonSelect>
                    </IonItem>
                </IonList>
                <p className="settings-note" data-testid="hider-blur-note">
                    {hiderBlur
                        ? 'The slower a hider moves, the less exactly seekers see where they are. From walking pace up, seekers see the exact spot.'
                        : 'Seekers always see exactly where each hider is.'}
                </p>

                <h3 className="settings-section">Jamming</h3>
                <IonList inset className="settings-list">
                    <IonItem>
                        <IonLabel>
                            <h2>Hiders can jam</h2>
                            <p>Hides them from seekers briefly</p>
                        </IonLabel>
                        <IonToggle
                            slot="end"
                            aria-label="Hiders can jam"
                            data-testid="jam-toggle"
                            checked={jam.enabled}
                            disabled={!editable}
                            onIonChange={(e) => setDraft((d) => ({ ...d, jam_enabled: e.detail.checked }))}
                        />
                    </IonItem>
                    {/* The two times only matter, and only show, while jamming is on */}
                    {jam.enabled && (
                        <IonItem>
                            <IonSelect
                                label="Jam lasts"
                                data-testid="jam-duration"
                                interface="action-sheet"
                                value={jam.duration_s}
                                disabled={!editable}
                                onIonChange={(e) => setDraft((d) => ({ ...d, jam_duration_s: e.detail.value }))}
                            >
                                {JAM_DURATIONS_S.map((s) => (
                                    <IonSelectOption key={s} value={s}>{formatDuration(s)}</IonSelectOption>
                                ))}
                            </IonSelect>
                        </IonItem>
                    )}
                    {jam.enabled && (
                        <IonItem>
                            <IonSelect
                                label="Charge time"
                                data-testid="jam-charge"
                                interface="action-sheet"
                                value={jam.charge_s / 60}
                                disabled={!editable}
                                onIonChange={(e) => setDraft((d) => ({ ...d, jam_charge_s: e.detail.value * 60 }))}
                            >
                                {JAM_CHARGES_MIN.map((m) => (
                                    <IonSelectOption key={m} value={m}>{formatDuration(m * 60)}</IonSelectOption>
                                ))}
                            </IonSelect>
                        </IonItem>
                    )}
                </IonList>
                <p className="settings-note" data-testid="jam-note">
                    {jam.enabled
                        ? 'While a hider jams, seekers only see where that hider was when it started. A jam charges from the moment the seekers set off, and again after each one.'
                        : 'Seekers can track every hider for the whole game.'}
                </p>

                <IonToast isOpen={!!error} message={error} duration={4000} onDidDismiss={() => setError('')} />
            </IonContent>
        </IonModal>
    );
}

export default SettingsSheet;
