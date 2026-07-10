import { Component } from 'react';

/**
 * Catches render errors so a bug never white-screens a live game.
 */
class ErrorBoundary extends Component
{
    constructor(props)
    {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError()
    {
        return { hasError: true };
    }

    componentDidCatch(error, info)
    {
        console.error('Unhandled render error:', error, info);
    }

    render()
    {
        if (this.state.hasError)
        {
            return (
                <div className="error-screen">
                    <div className="error-card">
                        <h1 className="error-title">Something Went Wrong</h1>
                        <p className="error-message">
                            The app hit an unexpected error. Reload to jump back into the game —
                            your session is saved.
                        </p>
                        <div className="error-actions">
                            <button
                                className="error-button primary"
                                onClick={() => window.location.reload()}
                            >
                                Reload
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
