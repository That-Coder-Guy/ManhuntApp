// TEMPORARY: confirms notifications reach this phone. Remove this file, its
// line in src/pages/Home.jsx and server/testPush.js once confirmed.
import { useState } from 'react';
import { IonButton } from '@ionic/react';
import { API_ORIGIN } from '../utils/api';
import { pushStatus, enablePush, notificationsWanted } from '../utils/push';

const API = `${API_ORIGIN}/manhunt-api/test-push`;

async function call(path, init)
{
    const response = await fetch(`${API}${path}`, { ...init, signal: AbortSignal.timeout(8000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.description || `The server said no (HTTP ${response.status})`);
    return data;
}

const WHY_NOT = {
    install: 'On iPhone, open Manhunt from your Home Screen to test notifications.',
    unsupported: 'This browser can’t show notifications.',
    denied: 'Notifications are blocked for Manhunt. Allow them in your phone’s settings.',
};

/** "Send a test notification": one arrives 30 seconds later, sent by the server */
function TestNotificationButton()
{
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    async function sendTest()
    {
        const status = pushStatus();
        if (WHY_NOT[status]) return setNote(WHY_NOT[status]);
        if (!notificationsWanted()) return setNote('Notifications are turned off. Turn them on in Settings first.');

        setBusy(true);
        try {
            // Asked first, in the tap itself (iPhones insist)
            if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted')
            {
                return setNote('Notifications weren’t allowed.');
            }
            const { public_key: key } = await call('/key');
            const subscription = await enablePush(key);
            const { delay_s: delay } = await call('', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription })
            });
            setNote(`Sent. It arrives in ${delay} seconds: lock your phone or switch apps to see it come in.`);
        } catch (error) {
            setNote(`Couldn’t send it: ${error.message}`);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="test-notification" data-testid="test-notification">
            <IonButton expand="block" className="button-secondary" data-testid="test-notification-btn" disabled={busy} onClick={sendTest}>
                {busy ? 'Sending…' : 'Send a test notification'}
            </IonButton>
            {note && <p className="test-notification-note" data-testid="test-notification-note">{note}</p>}
        </div>
    );
}

export default TestNotificationButton;
