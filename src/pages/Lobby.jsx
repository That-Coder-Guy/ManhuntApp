import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import LobbyFound from '../components/LobbyFound';
import LobbyLoading from '../components/LobbyLoading';
import LobbyError from '../components/LobbyError';
import PlayerError from '../components/PlayerError';
import PermissionsGate from '../components/PermissionsGate';
import useLobbySocket, { JOIN_STATE } from '../hooks/useLobbySocket';
import { loadSession, updateSession, clearSession } from '../utils/session';
import { currentSubscription } from '../utils/push';
import { isInstalled, useInstallOffer } from '../utils/install';

function LobbySession({ lobbyId })
{
    // Read once per lobby (the route keys this component by lobby ID)
    const [credentials] = useState(() => loadSession(lobbyId));
    // The browser asks on the way in; the installed app asked when it first opened
    const [permissionsDone, setPermissionsDone] = useState(isInstalled);
    const installOffer = useInstallOffer();

    const saveSession = useCallback((joined) => updateSession(lobbyId, { playerToken: joined.player_token }), [lobbyId]);
    const forgetSession = useCallback(() =>
    {
        clearSession(lobbyId, { everything: true });
    }, [lobbyId]);

    const lobby = useLobbySocket(lobbyId, credentials, saveSession);
    const { joinState, pushKey, registerPush } = lobby;

    useEffect(() =>
    {
        // A dead token can't be resumed: forget it so the next visit joins
        // fresh (a creator keeps their host key)
        if (joinState === JOIN_STATE.PLAYER_TIMED_OUT) clearSession(lobbyId);
        if (joinState === JOIN_STATE.KICKED) clearSession(lobbyId, { everything: true });
    }, [joinState, lobbyId]);

    switch (joinState)
    {
        case JOIN_STATE.CONNECTING:
            return <LobbyLoading />;

        case JOIN_STATE.JOINED:
            return (
                <>
                    <LobbyFound lobbyId={lobbyId} lobby={lobby} onLeft={forgetSession} />
                    <PermissionsGate
                        // After the first-visit install offer, never on top of it
                        isOpen={!permissionsDone && installOffer.status === 'done'}
                        onComplete={() => setPermissionsDone(true)}
                        // Allowed just now: subscribe and tell the server straight away
                        onNotificationsOn={() => currentSubscription(pushKey).then((sub) => sub && registerPush(sub))}
                        // Turned off: the server forgets this phone's subscription
                        onNotificationsOff={() => registerPush(null).catch(() => {})}
                    />
                </>
            );

        case JOIN_STATE.PLAYER_TIMED_OUT:
            return <PlayerError lobbyId={lobbyId} />;

        case JOIN_STATE.KICKED:
            return <PlayerError lobbyId={lobbyId} kicked />;

        default:
            return <LobbyError />;
    }
}

function Lobby()
{
    const { lobby_id: lobbyId } = useParams();
    // Keyed so moving between lobbies remounts with that lobby's own session
    return <LobbySession key={lobbyId} lobbyId={lobbyId} />;
}

export default Lobby;
