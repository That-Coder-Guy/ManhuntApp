import { useState, useRef, useEffect } from 'react';

function PlayerNameEditor({ currentName, updatePlayer })
{
    const [isEditing, setIsEditing] = useState(false);
    const [nameInput, setNameInput] = useState(currentName || '');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);

    const MAX_NAME_LENGTH = 30;

    // Start editing mode
    function handleEditClick()
    {
        setNameInput(currentName || '');
        setIsEditing(true);
        setError('');
    }

    // Focus input when editing starts
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isEditing]);

    // Keep readonly display in sync when the name changes elsewhere
    useEffect(() => {
        if (!isEditing) {
            setNameInput(currentName || '');
        }
    }, [currentName, isEditing]);

    // Cancel editing
    function handleCancel()
    {
        setIsEditing(false);
        setNameInput(currentName || '');
        setError('');
    }

    // Save the new name
    async function handleSave()
    {
        // Validate name
        const trimmedName = nameInput.trim();

        if (!trimmedName)
        {
            setError('Name cannot be empty');
            return;
        }

        if (trimmedName.length > MAX_NAME_LENGTH)
        {
            setError(`Name must be ${MAX_NAME_LENGTH} characters or less`);
            return;
        }

        if (trimmedName === currentName)
        {
            setIsEditing(false);
            return;
        }

        setIsLoading(true);
        setError('');

        try
        {
            await updatePlayer({ name: trimmedName });
            setIsEditing(false);
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

    // Handle Enter key to save
    function handleKeyDown(e)
    {
        if (e.key === 'Enter' && isEditing)
        {
            handleSave();
        }
        else if (e.key === 'Escape' && isEditing)
        {
            handleCancel();
        }
    }

    return (
        <div className="name-editor">
            <div className={`name-editor-controls ${error ? 'error' : ''}`}>
                <input
                    ref={inputRef}
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    maxLength={MAX_NAME_LENGTH}
                    disabled={!isEditing || isLoading}
                    className={`name-input ${!isEditing ? 'readonly' : ''}`}
                />
                <div className="name-editor-buttons">
                    {!isEditing ? (
                        <button
                            onClick={handleEditClick}
                            className="name-edit-btn"
                        >
                            Edit
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={handleSave}
                                disabled={isLoading}
                                className="name-save-btn"
                            >
                                {isLoading ? '...' : 'Save'}
                            </button>
                            <button
                                onClick={handleCancel}
                                disabled={isLoading}
                                className="name-cancel-btn"
                            >
                                Cancel
                            </button>
                        </>
                    )}
                </div>
            </div>
            {error && (
                <p className="name-error">
                    {error}
                </p>
            )}
            {isEditing && (
                <p className="name-counter">
                    {nameInput.length}/{MAX_NAME_LENGTH} characters
                </p>
            )}
        </div>
    );
}

export default PlayerNameEditor;
