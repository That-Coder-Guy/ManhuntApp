function LobbyLoading() {
    return (
        <div className="loading-screen">
            <div className="loading-card">
                <div className="loading-spinner" aria-hidden="true" />
                <h2 className="loading-title">Joining Lobby…</h2>
                <p className="loading-message">Please wait while we connect you to the lobby.</p>
            </div>
        </div>
    );
}

export default LobbyLoading;
