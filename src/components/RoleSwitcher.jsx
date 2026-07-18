import { useEffect, useRef, useState } from 'react';
import { IonSegment, IonSegmentButton, IonLabel, IonNote } from '@ionic/react';

function RoleSwitcher({ isSeeker, updatePlayer })
{
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const errorTimerRef = useRef(null);

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

    async function handleRoleChange(newIsSeeker)
    {
        if (newIsSeeker === isSeeker) return;

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
        <div className="ion-margin-vertical">
            <IonSegment
                className={`role-segment role-segment--${isSeeker ? 'seeker' : 'hider'}`}
                value={isSeeker ? 'seeker' : 'hider'}
                disabled={isLoading}
                onIonChange={(e) => handleRoleChange(e.detail.value === 'seeker')}
            >
                <IonSegmentButton value="seeker" data-testid="role-seeker">
                    <IonLabel>Seeker</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="hider" data-testid="role-hider">
                    <IonLabel>Hider</IonLabel>
                </IonSegmentButton>
            </IonSegment>
            {error && (
                <IonNote color="danger" data-testid="role-error" style={{ display: 'block', padding: '6px 4px' }}>
                    {error}
                </IonNote>
            )}
        </div>
    );
}

export default RoleSwitcher;
