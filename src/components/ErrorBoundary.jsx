import { Component } from 'react';

/**
 * Catches render errors so a bug never white-screens a live game.
 * Deliberately renders plain HTML — if the crash came from inside the UI
 * library, the fallback must not depend on it.
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
                <div className="fatal-error-screen">
                    <div>
                        <h1>Something Went Wrong</h1>
                        <p>
                            The app hit an unexpected error. Reload to jump back into the game —
                            your session is saved.
                        </p>
                        <button onClick={() => window.location.reload()}>
                            Reload
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
