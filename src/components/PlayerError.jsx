import { useNavigate } from 'react-router-dom';

function PlayerError({ lobbyId }) {
    const navigate = useNavigate();

    const handleRejoin = () => {
        window.location.href = `/lobby/${lobbyId}`;
    };

    const handleGoHome = () => {
        navigate('/');
    };

    return (
        <div className="error-screen">
            <div className="error-card">
                <h1 className="error-title">Player Timed Out</h1>
                <p className="error-message">
                    Your player session has expired. Rejoin the lobby to continue playing.
                </p>
                <div className="error-actions">
                    <button className="error-button primary" onClick={handleRejoin}>
                        Rejoin Lobby
                    </button>
                    <button className="error-button" onClick={handleGoHome}>
                        Go Home
                    </button>
                </div>
            </div>
        </div>
    );
}

export default PlayerError;

