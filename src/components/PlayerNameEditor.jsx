import { useEffect, useState } from 'react';
import { IonItem, IonInput, IonButton, IonNote, IonToast } from '@ionic/react';

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
            setError('Enter a name');
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
                : "Couldn't save your name. Try again.");
        }
        finally
        {
            setIsLoading(false);
        }
    }

    return (
        <>
            <IonItem className="name-card">
                {/* Label sits in the row container, outside the input chip */}
                <div className="name-field">
                    <IonNote className="name-field-label">Your name</IonNote>
                    {/* Save overlays the input's permanently-reserved trailing
                        strip rather than being slotted into it, so showing the
                        button can never resize the chip. */}
                    <div className="name-input-wrap">
                        <IonInput
                            data-testid="name-input"
                            aria-label="Your name"
                            maxlength={MAX_NAME_LENGTH}
                            value={nameInput}
                            disabled={isLoading}
                            onIonInput={(e) => { setNameInput(e.detail.value ?? ''); setError(''); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' && isDirty) handleSave(); }}
                        />
                        {isDirty && (
                            <IonButton
                                data-testid="name-save"
                                fill="solid"
                                size="small"
                                className="name-save-btn"
                                disabled={isLoading}
                                onClick={handleSave}
                            >
                                {isLoading ? '…' : 'Save'}
                            </IonButton>
                        )}
                    </div>
                </div>
            </IonItem>
            {/* A toast, not an inline note, so an error never changes the
                height of the cards on the page */}
            <IonToast
                isOpen={!!error}
                message={error}
                duration={4000}
                data-testid="name-error"
                onDidDismiss={() => setError('')}
            />
        </>
    );
}

export default PlayerNameEditor;
