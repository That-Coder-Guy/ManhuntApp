import { useLayoutEffect, useRef, useState } from 'react';
import { IonList, IonItem, IonLabel, IonToggle, IonNote, IonButton, IonAlert } from '@ionic/react';
import { useLocationPermission, useNotificationPermission, useCompassPermission, useCameraPermission } from '../hooks/usePermissions';
import { phoneSettingsOpener } from '../utils/nativeApp';

// Said only when the switch can't say it: plain on and off need no words
const STATUS_LABELS = {
    requesting: 'Asking…',
    denied: 'Blocked',
    unsupported: 'Not available on this device',
    install: 'Only in the Home Screen app',
};

function PermissionRow({ id, title, requirement, description, status, onToggle, onLockedTap, checked = status === 'granted', disabled })
{
    const note = STATUS_LABELS[status];
    // Once allowed, only the phone's own settings can take it back
    const locked = disabled ?? !['prompt', 'denied'].includes(status);
    return (
        // A locked switch takes no taps itself, so one meant for it lands on its row
        <IonItem data-testid={`row-${id}`} onClick={locked ? onLockedTap : undefined}>
            <IonLabel>
                <h3>
                    <span className="permission-title">{title}</span>
                    <IonNote className="permission-requirement">{requirement}</IonNote>
                </h3>
                <p>{description}</p>
                {note && (
                    <IonNote className={`permission-status${status === 'denied' ? ' permission-status--blocked' : ''}`} data-testid={`${id}-status`}>
                        {note}
                    </IonNote>
                )}
            </IonLabel>
            <IonToggle
                slot="end"
                data-testid={`toggle-${id}`}
                aria-label={title}
                checked={checked}
                disabled={locked}
                // (the row passes a tap on its padding to its switch, locked or not)
                onClick={locked ? undefined : onToggle}
            />
        </IonItem>
    );
}

/**
 * Everything Manhunt may use on this phone, each with a switch that asks for
 * it: "Before you play" on entering a lobby, the installed app's permissions
 * page (PermissionsSetup), and the Settings page. A switch can ask; once
 * answered, only the phone's own settings can change it, and a tap on one
 * says so. `location` and `compass` let the caller
 * share its own state for those (the required ones: useRequiredPermissions);
 * `onNotificationsOn` runs when notifications are allowed. `showCamera` adds
 * the camera (for scanning join codes), which matters outside a lobby: the
 * installed app's permissions page, and Settings.
 */
function PermissionsList({ location, compass, onNotificationsOn, showCamera = false })
{
    const ownLocation = useLocationPermission();
    const ownCompass = useCompassPermission();
    const [locationStatus, requestLocation, locationKnown] = location ?? ownLocation;
    const [compassStatus, requestCompass] = compass ?? ownCompass;
    const [notifyStatus, toggleNotificationsState] = useNotificationPermission();
    const toggleNotifications = async () =>
    {
        if (await toggleNotificationsState() === 'granted') onNotificationsOn?.();
    };
    const [cameraStatus, toggleCamera, cameraKnown] = useCameraPermission();
    // Until the browser's first-ever answer arrives (a few milliseconds), the
    // switches stay hidden rather than show a state they'd jump away from
    const settled = locationKnown !== false && (!showCamera || cameraKnown !== false);
    // A switch can ask, but it can't undo a refusal: only the phone's settings can
    const blocked = [locationStatus, compassStatus, notifyStatus, showCamera ? cameraStatus : null].includes('denied');
    const openPhoneSettings = phoneSettingsOpener();

    // A tap on a switch that can't do what the tap means. One that's on can
    // only be turned off in the phone's settings: say so, and offer to go
    // there (the native apps can; a browser can only say where to look). One
    // that's blocked can only be allowed there: the same as the button under
    // the list. `inSettings: false` is the compass, which has no setting.
    const [turnOff, setTurnOff] = useState({ open: false, header: '', message: '', buttons: [] });
    const lockedTap = (title, status, { required = false, inSettings = true } = {}) => () =>
    {
        if (status === 'denied') return openPhoneSettings?.();
        if (status !== 'granted') return undefined;

        const name = title.toLowerCase();
        const needed = required ? ' A game can’t be joined without it.' : '';
        if (!inSettings)
        {
            return setTurnOff({
                open: true,
                header: `The ${name} stays on`,
                message: `Manhunt can’t turn the ${name} off.${needed}`,
                buttons: ['OK']
            });
        }
        return setTurnOff({
            open: true,
            // ("Settings" alone would be this app's own page, where this may be showing)
            header: `Turn ${name} off in your phone’s settings`,
            message: openPhoneSettings
                ? `Manhunt can’t turn ${name} off itself: only your phone’s settings can.${needed}`
                : `Manhunt can’t turn ${name} off itself: only your phone’s or browser’s settings for Manhunt can.${needed}`,
            buttons: openPhoneSettings
                ? [{ text: 'Not now', role: 'cancel' }, { text: 'Open settings', handler: () => { openPhoneSettings({ direct: true }); } }]
                : ['OK']
        });
    };

    // "Required" and "Optional" start on one line down the list: every title
    // gets the width of the longest one, measured once the font has loaded
    const listRef = useRef(null);
    const measureTitles = useRef(() => {});
    measureTitles.current = () =>
    {
        const list = listRef.current;
        if (!list) return;
        const range = document.createRange();
        let widest = 0;
        for (const title of list.querySelectorAll('.permission-title'))
        {
            range.selectNodeContents(title); // the text itself, whatever width it's been given
            widest = Math.max(widest, range.getBoundingClientRect().width);
        }
        // Nothing measurable yet (a popup still opening): the resize brings it back
        if (widest) list.style.setProperty('--permission-title-width', `${Math.ceil(widest)}px`);
    };
    // Again once laid out (popups open after their first render) and once
    // the font has loaded, and after any render (rows come and go)
    useLayoutEffect(() =>
    {
        const list = listRef.current;
        if (!list) return undefined;
        let cancelled = false;
        const measure = () => { if (!cancelled) measureTitles.current(); };
        const watcher = new ResizeObserver(measure);
        watcher.observe(list);
        document.fonts?.ready.then(measure);
        return () =>
        {
            cancelled = true;
            watcher.disconnect();
        };
    }, []);
    useLayoutEffect(() => measureTitles.current());

    return (
        <>
        <IonList ref={listRef} inset className="permission-list" style={settled ? undefined : { visibility: 'hidden' }}>
            <PermissionRow
                id="location"
                title="Location"
                requirement="Required"
                description="How far away players are"
                status={locationStatus}
                // A refusal can't be asked again from here; the phone's settings can
                disabled={locationStatus !== 'prompt'}
                onToggle={requestLocation}
                onLockedTap={lockedTap('Location', locationStatus, { required: true })}
            />
            {compassStatus !== 'unsupported' && (
                <PermissionRow
                    id="compass"
                    title="Compass"
                    requirement="Required"
                    description="Points the arrow the right way"
                    status={compassStatus}
                    onToggle={requestCompass}
                    onLockedTap={lockedTap('Compass', compassStatus, { required: true, inSettings: false })}
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
                    // Asks once. ('off' is a choice made in older versions: it turns back on)
                    disabled={!['prompt', 'off'].includes(notifyStatus)}
                    onToggle={toggleNotifications}
                    onLockedTap={lockedTap('Notifications', notifyStatus)}
                />
            )}
            {showCamera && cameraStatus !== 'unsupported' && (
                <PermissionRow
                    id="camera"
                    title="Camera"
                    requirement="Optional"
                    description="For scanning join codes"
                    status={cameraStatus}
                    // Asks once. ('off' is a choice made in older versions: it turns back on)
                    disabled={!['prompt', 'off'].includes(cameraStatus)}
                    onToggle={toggleCamera}
                    onLockedTap={lockedTap('Camera', cameraStatus)}
                />
            )}
        </IonList>
        {settled && blocked && (
            <div className="permission-blocked" data-testid="permission-blocked">
                <p className="settings-note">
                    {openPhoneSettings
                        ? 'A blocked one can only be allowed in your phone’s settings for Manhunt.'
                        : 'A blocked one can only be allowed in your phone’s or browser’s settings for Manhunt. Allow it there, then come back.'}
                </p>
                {openPhoneSettings && (
                    <IonButton size="small" className="button-secondary" data-testid="open-phone-settings" onClick={() => openPhoneSettings()}>
                        Open settings
                    </IonButton>
                )}
            </div>
        )}
        <IonAlert
            data-testid="permission-turn-off"
            isOpen={turnOff.open}
            header={turnOff.header}
            message={turnOff.message}
            buttons={turnOff.buttons}
            // (what it says stays while it closes)
            onDidDismiss={() => setTurnOff((alert) => ({ ...alert, open: false }))}
        />
        </>
    );
}

export default PermissionsList;
