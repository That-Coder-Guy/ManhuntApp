import { useEffect, useRef, useState } from 'react';
import { IonItem, IonInput, IonButton, IonNote, IonToast, IonActionSheet } from '@ionic/react';
import Avatar from './Avatar';
import { fileToAvatar } from '../utils/avatar';

const MAX_NAME_LENGTH = 30;

/**
 * The pregame "you" card: profile picture and name. Fixed height, so the
 * Save button appearing or an error never moves anything below it.
 */
function ProfileCard({ player, avatar, updatePlayer, setAvatar })
{
    const currentName = player?.name || '';
    const [nameInput, setNameInput] = useState(currentName);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isPhotoMenuOpen, setIsPhotoMenuOpen] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef(null);

    // Follow the server when the name changes elsewhere (resume, host, other tab)
    useEffect(() => { setNameInput(currentName); }, [currentName]);

    const trimmed = nameInput.trim();
    const isDirty = trimmed !== currentName;

    const describe = (err, fallback) => (err.status === 'network_error'
        ? "Couldn't reach the server. Check your connection and try again."
        : err.message || fallback);

    async function saveName()
    {
        // Length is capped by the input's maxlength (and again by the server)
        if (!trimmed) return setError('Enter a name');
        setIsSaving(true);
        try {
            await updatePlayer({ name: trimmed });
        } catch (err) {
            setError(describe(err, "Couldn't save your name. Try again."));
        } finally {
            setIsSaving(false);
        }
    }

    async function choosePhoto(event)
    {
        const file = event.target.files?.[0];
        event.target.value = ''; // picking the same file again still fires
        if (!file) return;

        setIsUploading(true);
        try {
            await setAvatar(await fileToAvatar(file));
        } catch (err) {
            setError(describe(err, "Couldn't use that picture."));
        } finally {
            setIsUploading(false);
        }
    }

    async function removePhoto()
    {
        try {
            await setAvatar(null);
        } catch (err) {
            setError(describe(err, "Couldn't remove your picture."));
        }
    }

    // With a picture, ask what to do; without one, go straight to the picker
    const openPhoto = () => (avatar ? setIsPhotoMenuOpen(true) : fileInputRef.current?.click());

    return (
        <>
            <IonItem className="name-card profile-card" data-testid="profile-card">
                <div className="profile-row">
                    <button
                        type="button"
                        className={`profile-avatar-btn${isUploading ? ' is-busy' : ''}`}
                        onClick={openPhoto}
                        disabled={isUploading}
                        aria-label={avatar ? 'Change or remove your picture' : 'Add a picture'}
                        data-testid="avatar-btn"
                    >
                        <Avatar name={currentName} src={avatar} size="lg" />
                        <span className="profile-avatar-hint" aria-hidden="true">{avatar ? 'Edit' : 'Add'}</span>
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={choosePhoto}
                        data-testid="avatar-input"
                    />

                    <div className="name-field">
                        <IonNote className="name-field-label">Your name</IonNote>
                        {/* Save overlays the input's reserved trailing strip, so it
                            appearing never resizes anything */}
                        <div className="name-input-wrap">
                            <IonInput
                                data-testid="name-input"
                                aria-label="Your name"
                                maxlength={MAX_NAME_LENGTH}
                                value={nameInput}
                                disabled={isSaving}
                                onIonInput={(e) => { setNameInput(e.detail.value ?? ''); setError(''); }}
                                onKeyDown={(e) => { if (e.key === 'Enter' && isDirty) saveName(); }}
                            />
                            {isDirty && (
                                <IonButton
                                    data-testid="name-save"
                                    fill="solid"
                                    size="small"
                                    className="name-save-btn"
                                    disabled={isSaving}
                                    onClick={saveName}
                                >
                                    {isSaving ? '…' : 'Save'}
                                </IonButton>
                            )}
                        </div>
                    </div>
                </div>
            </IonItem>

            <IonActionSheet
                isOpen={isPhotoMenuOpen}
                header="Your picture"
                buttons={[
                    { text: 'Choose a new picture', handler: () => fileInputRef.current?.click() },
                    { text: 'Remove picture', role: 'destructive', handler: removePhoto },
                    { text: 'Cancel', role: 'cancel' }
                ]}
                onDidDismiss={() => setIsPhotoMenuOpen(false)}
            />

            {/* A toast, so an error never changes the height of the cards */}
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

export default ProfileCard;
