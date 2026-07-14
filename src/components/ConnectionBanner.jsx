import { useEffect, useState } from 'react';
import { CONNECTION_STATE } from '../hooks/useLobbySocket';
import { getTimeAgo } from '../utils/time';

/**
 * Slim status strips rendered inside the page's fixed IonHeader while the
 * socket is reconnecting or GPS is lost. Hidden entirely when healthy.
 */
function ConnectionBanner({ connectionState, lastSyncTime, gpsError })
{
    const reconnecting = connectionState !== CONNECTION_STATE.CONNECTED;

    // Tick every second while visible so the "last update" label stays current
    const [, setTick] = useState(0);
    useEffect(() =>
    {
        if (!reconnecting) return undefined;
        const intervalId = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(intervalId);
    }, [reconnecting]);

    if (!reconnecting && !gpsError) return null;

    return (
        <>
            {reconnecting && (
                <div className="connection-banner connection-banner-offline" role="status" data-testid="offline-banner">
                    {navigator.onLine === false ? 'Offline' : 'Reconnecting…'}
                    {' · last positions'}
                    {lastSyncTime ? ` · ${getTimeAgo(lastSyncTime)}` : ''}
                </div>
            )}
            {gpsError && (
                <div className="connection-banner connection-banner-gps" role="status" data-testid="gps-banner">
                    GPS signal lost
                </div>
            )}
        </>
    );
}

export default ConnectionBanner;
