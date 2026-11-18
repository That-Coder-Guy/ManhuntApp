import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import LobbyFound from '../components/LobbyFound';
import LobbyLoading from '../components/LobbyLoading';
import LobbyError from '../components/LobbyError';
import PlayerError from '../components/PlayerError';
import PermissionsGate from '../components/PermissionsGate';
import useLobbySocket, { JOIN_STATE } from '../hooks/useLobbySocket';
import { loadSession, updateSession, clearSession } from '../utils/session';
import { currentSubscription } from '../utils/push';
import { isInstalled, useInstallOffer } from '../utils/install';
import { useRequiredPermissions } from '../hooks/usePermissions';

function LobbySession({ lobbyId })
{
    // Read once per lobby (the route keys this component by lobby ID)
    const [credentials] = useState(() => loadSession(lobbyId));
    const navigate = useNavigate();
    const installOffer = useInstallOffer();

    // "Before you play". The browser asks on the way into every lobby. The
    // installed app offered the same when it first opened, where it could be
    // put off; here it can't be, so it asks again only if something a game
    // needs is still missing. 'unknown' lasts the few milliseconds until the
    // browser has said what's allowed.
    const permissions = useRequiredPermissions();
    const permissionsKnown = permissions.location[2] !== false;
    const [gate, setGate] = useState(() => (isInstalled() ? 'unknown' : 'open')); // 'unknown' | 'open' | 'passed'
    useEffect(() =>
    {
        if (gate === 'unknown' && permissionsKnown) setGate(permissions.ready ? 'passed' : 'open');
    }, [gate, permissionsKnown, permissions.ready]);

    const saveSession = useCallback((joined) => updateSession(lobbyId, { playerToken: joined.player_token }), [lobbyId]);
    const forgetSession = useCallback(() =>
    {
        clearSession(lobbyId, { everything: true });
    }, [lobbyId]);

    const lobby = useLobbySocket(lobbyId, credentials, saveSession);
    const { joinState, pushKey, registerPush, leaveLobby } = lobby;

    // "Leave lobby" on "Before you play": no one is held at a permission
    // they don't want to give. (leaveLobby never rejects.)
    const leaveFromGate = useCallback(async () =>
    {
        await leaveLobby();
        forgetSession();
        navigate('/');
    }, [leaveLobby, forgetSession, navigate]);

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
                        isOpen={gate === 'open' && installOffer.status === 'done'}
                        permissions={permissions}
                        onComplete={() => setGate('passed')}
                        onLeave={leaveFromGate}
                        // Allowed just now: subscribe and tell the server straight away
                        onNotificationsOn={() => currentSubscription(pushKey).then((sub) => sub && registerPush(sub))}
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
