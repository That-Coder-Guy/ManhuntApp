import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ShareModal from './ShareModal';

function LobbyHeader({ lobbyId, lobbyName, leaveLobby, onClearSession, onOpenPlayerTable })
{
    const navigate = useNavigate();
    const [isLeaving, setIsLeaving] = useState(false);
    const [confirmingLeave, setConfirmingLeave] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const confirmTimerRef = useRef(null);

    useEffect(() => () => {
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    }, []);

    // First tap arms the confirm; second tap within the window actually leaves,
    // so a mis-tap next to "View Players" can't eject a player mid-game.
    async function handleLeaveClick()
    {
        if (!confirmingLeave) {
            setConfirmingLeave(true);
            confirmTimerRef.current = setTimeout(() => setConfirmingLeave(false), 3000);
            return;
        }

        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
        setConfirmingLeave(false);
        setIsLeaving(true);
        try {
            await leaveLobby();
        } catch (error) {
            console.error('Error leaving lobby:', error);
        } finally {
            onClearSession();
            navigate('/');
        }
    }

    return (
        <div className="lobby-header lobby-card-base">
            <div className="lobby-info">
                <h1 className="lobby-title">{lobbyName}</h1>
                <p className="lobby-id">Lobby ID: {lobbyId}</p>
            </div>
            <div className="lobby-header-buttons">
                <button
                    onClick={() => setIsShareOpen(true)}
                    className="invite-btn"
                >
                    Invite
                </button>
                <button
                    onClick={onOpenPlayerTable}
                    className="view-players-btn"
                >
                    View Players
                </button>
                <button
                    onClick={handleLeaveClick}
                    disabled={isLeaving}
                    className={`leave-lobby-btn ${confirmingLeave ? 'confirming' : ''}`}
                >
                    {isLeaving ? 'Leaving…' : confirmingLeave ? 'Tap to confirm' : 'Leave Lobby'}
                </button>
            </div>

            <ShareModal
                lobbyId={lobbyId}
                isOpen={isShareOpen}
                onClose={() => setIsShareOpen(false)}
            />
        </div>
    );
}

export default LobbyHeader;
