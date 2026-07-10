import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function LobbyHeader({ lobbyId, lobbyName, leaveLobby, onClearSession, onOpenPlayerTable })
{
    const navigate = useNavigate();
    const [isLeaving, setIsLeaving] = useState(false);

    // Function to leave lobby
    async function handleLeaveLobby()
    {
        setIsLeaving(true);
        try {
            await leaveLobby();
        } catch (error) {
            console.error('Error leaving lobby:', error);
        } finally {
            // Clear saved session when user explicitly leaves
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
                    onClick={onOpenPlayerTable}
                    className="view-players-btn"
                >
                    View Players
                </button>
                <button
                    onClick={handleLeaveLobby}
                    disabled={isLeaving}
                    className="leave-lobby-btn"
                >
                    {isLeaving ? 'Leaving…' : 'Leave Lobby'}
                </button>
            </div>
        </div>
    );
}

export default LobbyHeader;
