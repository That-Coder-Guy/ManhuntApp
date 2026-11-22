import { useEffect, useRef, useState } from 'react';
import {
    IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonFooter, IonInput, IonToast, IonIcon
} from '@ionic/react';
import { imageOutline, closeOutline } from 'ionicons/icons';
import { CHAT_MAX_CHARS, messageTime } from '../utils/chat';
import { compressChatImage, formatBytes } from '../utils/chatImage';
import { chatImageUrl } from '../utils/api';
import { playerName } from '../utils/players';

/**
 * A picture in a message: a button showing it small, that opens it full
 * screen. The space it takes is known before it loads (its size comes with
 * the message), so the conversation doesn't jump as pictures arrive. A
 * picture the server no longer keeps says so instead.
 */
function ChatPicture({ lobbyId, image, from, onOpen })
{
    const [failed, setFailed] = useState(false);
    if (image.gone || failed)
    {
        return <p className="chat-image-gone" data-testid="chat-image-gone">Picture no longer kept</p>;
    }
    const src = chatImageUrl(lobbyId, image.id);
    // Sized here, from the numbers, not by the picture once it has loaded.
    // The most it is shown at: 15rem wide or the picture's own width, and no
    // taller than 18rem (--chat-image-height), in the picture's own shape
    const most = {
        '--chat-image-width': `min(15rem, ${image.width}px, calc(var(--chat-image-height) * ${image.width} / ${image.height}))`
    };
    // The wrapper is what gives the message its width (index.css): that
    // much beside words, and nothing at all in a message with only a
    // picture, which is then as narrow as its header and the picture fills it
    return (
        <div className="chat-image-fit" style={most}>
            <button
                type="button"
                className="chat-image"
                style={{ aspectRatio: `${image.width} / ${image.height}` }}
                data-testid="chat-image"
                aria-label={`Open the picture from ${from}`}
                onClick={() => onOpen({ src, from, width: image.width, height: image.height })}
            >
                <img src={src} width={image.width} height={image.height} alt="" loading="lazy" onError={() => setFailed(true)} />
            </button>
        </div>
    );
}

/**
 * The lobby's chat: one conversation everyone in the lobby shares, seekers
 * and hiders alike, before, during and after a game. Newest at the bottom,
 * with the box to write in under it. A message is words, a picture, or both;
 * a picture is compressed on this phone before it's sent (utils/chatImage.js)
 * and opens full screen when tapped.
 */
function ChatModal({ isOpen, onClose, lobbyId, messages, players, selfId, showRoles = false, sendChat })
{
    const contentRef = useRef(null);
    const fileRef = useRef(null);
    const [text, setText] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState('');
    // The picture chosen for the next message: { blob, type, width, height, url }
    const [picture, setPicture] = useState(null);
    const [isPreparing, setIsPreparing] = useState(false);
    // The picture open full screen: { src, from, width, height }
    const [viewing, setViewing] = useState(null);

    // Keep the newest message in view: on opening, and as each one arrives
    const lastId = messages.length ? messages[messages.length - 1].id : 0;
    useEffect(() =>
    {
        if (isOpen) contentRef.current?.scrollToBottom(200);
    }, [isOpen, lastId]);

    // The preview's address holds the picture in memory until it's let go
    const pictureUrl = picture?.url;
    useEffect(() => () => { if (pictureUrl) URL.revokeObjectURL(pictureUrl); }, [pictureUrl]);

    async function choosePicture(event)
    {
        const file = event.target.files?.[0];
        // So choosing the same file again still counts as a change
        event.target.value = '';
        if (!file || isPreparing) return;
        setIsPreparing(true);
        try {
            const prepared = await compressChatImage(file);
            setPicture({ ...prepared, url: URL.createObjectURL(prepared.blob) });
        } catch (err) {
            setError(err.message || "That picture couldn't be used. Try another one.");
        } finally {
            setIsPreparing(false);
        }
    }

    async function send()
    {
        const message = text.trim();
        if ((!message && !picture) || isSending) return;
        setIsSending(true);
        try {
            const image = picture
                ? { data: await picture.blob.arrayBuffer(), width: picture.width, height: picture.height }
                : null;
            await sendChat(message, image);
            setText('');
            setPicture(null);
        } catch (err) {
            setError(err.status === 'network_error'
                ? "Couldn't reach the server. Check your connection and try again."
                : err.message || 'That didn’t send. Try again.');
        } finally {
            setIsSending(false);
        }
    }

    return (
        <IonModal
            isOpen={isOpen}
            onDidPresent={() => contentRef.current?.scrollToBottom(0)}
            onDidDismiss={onClose}
            className="chat-modal"
            data-testid="chat-modal"
        >
            <IonHeader>
                <IonToolbar>
                    <IonTitle>Chat</IonTitle>
                    <IonButtons slot="end">
                        <IonButton data-testid="chat-close" onClick={onClose}>Close</IonButton>
                    </IonButtons>
                </IonToolbar>
            </IonHeader>

            <IonContent ref={contentRef} className="ion-padding chat-content">
                {messages.length === 0 ? (
                    <p className="chat-empty" data-testid="chat-empty">No messages yet. Everyone in the lobby sees what’s written here.</p>
                ) : (
                    <ol className="chat-list" data-testid="chat-list">
                        {messages.map((message) =>
                        {
                            const mine = message.player_id === selfId;
                            // Their name now, if they're still here; else the one the message was sent under
                            const sender = players.find((p) => p.player_id === message.player_id);
                            const name = mine ? 'You' : sender ? playerName(sender) : message.name || 'A player who left';
                            return (
                                <li
                                    key={message.id}
                                    // A picture and no words: only as wide as its header needs
                                    className={`chat-message${mine ? ' chat-message--mine' : ''}${message.image && !message.text ? ' chat-message--picture' : ''}`}
                                    data-testid="chat-message"
                                >
                                    <div className="chat-meta">
                                        <span className="chat-name">{name}</span>
                                        {showRoles && sender && <span className="chat-role">{sender.is_seeker ? 'Seeker' : 'Hider'}</span>}
                                        <span className="chat-time">{messageTime(message.at)}</span>
                                    </div>
                                    {message.image && (
                                        <ChatPicture lobbyId={lobbyId} image={message.image} from={mine ? 'you' : name} onOpen={setViewing} />
                                    )}
                                    {message.text && <p className="chat-text">{message.text}</p>}
                                </li>
                            );
                        })}
                    </ol>
                )}
            </IonContent>

            <IonFooter className="chat-footer">
                {picture && (
                    <div className="chat-attachment" data-testid="chat-attachment">
                        <img src={picture.url} alt="The picture you’re about to send" />
                        <span className="chat-attachment-note">Picture · {formatBytes(picture.blob.size)}</span>
                        <button type="button" className="chat-attachment-remove" data-testid="chat-attachment-remove" aria-label="Remove the picture" onClick={() => setPicture(null)}>
                            <IonIcon icon={closeOutline} aria-hidden="true" />
                        </button>
                    </div>
                )}
                <div className="chat-form">
                    <input ref={fileRef} type="file" accept="image/*" hidden data-testid="chat-file" onChange={choosePicture} />
                    <button
                        type="button"
                        className="chat-attach"
                        data-testid="chat-attach"
                        aria-label={picture ? 'Choose a different picture' : 'Add a picture'}
                        disabled={isPreparing || isSending}
                        onClick={() => fileRef.current?.click()}
                    >
                        <IonIcon icon={imageOutline} aria-hidden="true" />
                    </button>
                    <IonInput
                        className="chat-input"
                        data-testid="chat-input"
                        aria-label="Message"
                        placeholder={picture ? 'Add a few words' : 'Message everyone'}
                        value={text}
                        maxlength={CHAT_MAX_CHARS}
                        enterkeyhint="send"
                        autocapitalize="sentences"
                        onIonInput={(e) => setText(e.detail.value ?? '')}
                        onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                    />
                    <IonButton data-testid="chat-send" disabled={(!text.trim() && !picture) || isSending || isPreparing} onClick={send}>
                        Send
                    </IonButton>
                </div>
            </IonFooter>

            {/* A picture, full screen: tap it, or Close, to go back */}
            <IonModal
                isOpen={!!viewing}
                onDidDismiss={() => setViewing(null)}
                className="chat-viewer"
                data-testid="chat-viewer"
            >
                <div className="chat-viewer-stage" onClick={() => setViewing(null)}>
                    {viewing && (
                        <img
                            src={viewing.src}
                            width={viewing.width}
                            height={viewing.height}
                            alt={`Picture from ${viewing.from}`}
                            data-testid="chat-viewer-image"
                        />
                    )}
                    <button type="button" className="chat-viewer-close" data-testid="chat-viewer-close" onClick={() => setViewing(null)}>
                        Close
                    </button>
                </div>
            </IonModal>

            <IonToast isOpen={!!error} message={error} duration={4000} onDidDismiss={() => setError('')} />
        </IonModal>
    );
}

export default ChatModal;
