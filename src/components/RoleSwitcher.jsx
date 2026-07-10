import { useEffect, useRef, useState } from 'react';

function RoleSwitcher({ isSeeker, updatePlayer })
{
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const errorTimerRef = useRef(null);

    // Auto-dismiss transient errors
    useEffect(() => () =>
    {
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    }, []);

    function showError(message)
    {
        setError(message);
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => setError(''), 5000);
    }

    // Handle role change
    async function handleRoleChange(newIsSeeker)
    {
        // Don't do anything if clicking the already selected role
        if (newIsSeeker === isSeeker)
        {
            return;
        }

        setIsLoading(true);
        setError('');

        try
        {
            await updatePlayer({ is_seeker: newIsSeeker });
        }
        catch (err)
        {
            // Never kick the player over a role change — show the problem inline
            console.error('Error updating role:', err);
            showError(err.status === 'network_error'
                ? "Couldn't update role — check your connection and try again."
                : 'Failed to update role. Please try again.');
        }
        finally
        {
            setIsLoading(false);
        }
    }

    return (
        <div className="role-switcher">
            <div className={`role-controls ${isSeeker ? 'seeker-active' : 'hider-active'}`}>
                {/* Seeker Button */}
                <button
                    onClick={() => handleRoleChange(true)}
                    disabled={isLoading}
                    className={`role-btn seeker ${isSeeker ? 'active' : ''}`}
                >
                    Seeker
                </button>

                {/* Hider Button */}
                <button
                    onClick={() => handleRoleChange(false)}
                    disabled={isLoading}
                    className={`role-btn hider ${!isSeeker ? 'active' : ''}`}
                >
                    Hider
                </button>
            </div>
            {error && (
                <p className="role-error">
                    {error}
                </p>
            )}
        </div>
    );
}

export default RoleSwitcher;
