import { useNavigate } from 'react-router-dom';

function LobbyError() {
    const navigate = useNavigate();

    const handleRetry = () => {
        window.location.reload();
    };

    const handleGoHome = () => {
        navigate('/');
    };

    return (
        <div className="error-screen">
            <div className="error-card">
                <h1 className="error-title">Unable to Join Lobby</h1>
                <p className="error-message">We couldn't connect you to the lobby. This might be caused by:</p>
                <ul className="error-list">
                    <li>Temporary network issues</li>
                    <li>Server downtime</li>
                    <li>An invalid or expired lobby ID</li>
                </ul>
                <div className="error-actions">
                    <button className="error-button primary" onClick={handleRetry}>
                        Try Again
                    </button>
                    <button className="error-button" onClick={handleGoHome}>
                        Go Home
                    </button>
                </div>
            </div>
        </div>
    );
}

export default LobbyError;
