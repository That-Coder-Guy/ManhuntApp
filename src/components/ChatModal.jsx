import { useEffect, useRef, useState } from 'react';
import {
    IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonFooter, IonInput, IonToast
} from '@ionic/react';
import { CHAT_MAX_CHARS, messageTime } from '../utils/chat';
import { playerName } from '../utils/players';

/**
 * The lobby's chat: one conversation everyone in the lobby shares, seekers
 * and hiders alike, before, during and after a game. Newest at the bottom,
 * with the box to write in under it.
 */
function ChatModal({ isOpen, onClose, messages, players, selfId, showRoles = false, sendChat })
{
    const contentRef = useRef(null);
    const [text, setText] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState('');

    // Keep the newest message in view: on opening, and as each one arrives
    const lastId = messages.length ? messages[messages.length - 1].id : 0;
    useEffect(() =>
    {
        if (isOpen) contentRef.current?.scrollToBottom(200);
    }, [isOpen, lastId]);

    async function send()
    {
        const message = text.trim();
        if (!message || isSending) return;
        setIsSending(true);
        try {
            await sendChat(message);
            setText('');
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
                                <li key={message.id} className={`chat-message${mine ? ' chat-message--mine' : ''}`} data-testid="chat-message">
                                    <div className="chat-meta">
                                        <span className="chat-name">{name}</span>
                                        {showRoles && sender && <span className="chat-role">{sender.is_seeker ? 'Seeker' : 'Hider'}</span>}
                                        <span className="chat-time">{messageTime(message.at)}</span>
                                    </div>
                                    <p className="chat-text">{message.text}</p>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </IonContent>

            <IonFooter className="chat-footer">
                <div className="chat-form">
                    <IonInput
                        className="chat-input"
                        data-testid="chat-input"
                        aria-label="Message"
                        placeholder="Message everyone"
                        value={text}
                        maxlength={CHAT_MAX_CHARS}
                        enterkeyhint="send"
                        autocapitalize="sentences"
                        onIonInput={(e) => setText(e.detail.value ?? '')}
                        onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                    />
                    <IonButton data-testid="chat-send" disabled={!text.trim() || isSending} onClick={send}>
                        Send
                    </IonButton>
                </div>
            </IonFooter>

            <IonToast isOpen={!!error} message={error} duration={4000} onDidDismiss={() => setError('')} />
        </IonModal>
    );
}

export default ChatModal;
