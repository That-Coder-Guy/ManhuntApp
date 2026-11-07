import { CONNECTION_STATE } from '../hooks/useLobbySocket';
import useNow from '../hooks/useNow';
import { getTimeAgo } from '../utils/time';
import FixDot from './FixDot';

/**
 * Slim status strips inside the page's fixed IonHeader while the socket is
 * reconnecting or GPS is lost. Renders nothing when healthy.
 */
function ConnectionBanner({ connectionState, lastSyncTime, gpsError })
{
    const reconnecting = connectionState !== CONNECTION_STATE.CONNECTED;
    // Only tick while the "positions from Xs ago" line is on screen
    const now = useNow(1000, reconnecting);

    return (
        <>
            {reconnecting && (
                <div className="connection-banner connection-banner-offline" role="status" data-testid="offline-banner">
                    <FixDot fresh={false} offline />
                    <span>
                        {navigator.onLine === false ? 'Offline' : 'Reconnecting'}
                        {lastSyncTime ? ` · positions from ${getTimeAgo(lastSyncTime, now)}` : ' · showing last positions'}
                    </span>
                </div>
            )}
            {gpsError && (
                <div className="connection-banner connection-banner-gps" role="status" data-testid="gps-banner">
                    <FixDot fresh={false} />
                    <span>GPS signal lost · your position isn't updating</span>
                </div>
            )}
        </>
    );
}

export default ConnectionBanner;
