import { useEffect, useState } from 'react';
import { IonItem, IonInput, IonButton, IonNote } from '@ionic/react';

const MAX_NAME_LENGTH = 30;

function PlayerNameEditor({ currentName, updatePlayer })
{
    const [nameInput, setNameInput] = useState(currentName || '');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // Keep in sync when the name changes elsewhere (join/resume)
    useEffect(() => {
        setNameInput(currentName || '');
    }, [currentName]);

    const trimmed = nameInput.trim();
    const isDirty = trimmed !== (currentName || '');

    async function handleSave()
    {
        if (!trimmed)
        {
            setError('Name cannot be empty');
            return;
        }
        if (trimmed.length > MAX_NAME_LENGTH)
        {
            setError(`Name must be ${MAX_NAME_LENGTH} characters or less`);
            return;
        }

        setIsLoading(true);
        setError('');
        try
        {
            await updatePlayer({ name: trimmed });
        }
        catch (err)
        {
            // Never kick the player over a name change — show the problem inline
            console.error('Error updating name:', err);
            setError(err.status === 'network_error'
                ? "Couldn't reach the server — check your connection and try again."
                : 'Failed to update name. Please try again.');
        }
        finally
        {
            setIsLoading(false);
        }
    }

    return (
        <>
            <IonItem className="glass-item">
                <IonInput
                    data-testid="name-input"
                    label="Your name"
                    labelPlacement="stacked"
                    maxlength={MAX_NAME_LENGTH}
                    value={nameInput}
                    disabled={isLoading}
                    onIonInput={(e) => { setNameInput(e.detail.value ?? ''); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && isDirty) handleSave(); }}
                />
                {isDirty && (
                    <IonButton
                        data-testid="name-save"
                        slot="end"
                        disabled={isLoading}
                        onClick={handleSave}
                    >
                        {isLoading ? '…' : 'Save'}
                    </IonButton>
                )}
            </IonItem>
            {error && (
                <IonNote color="danger" data-testid="name-error" style={{ display: 'block', padding: '4px 16px' }}>
                    {error}
                </IonNote>
            )}
        </>
    );
}

export default PlayerNameEditor;
