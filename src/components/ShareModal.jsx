import { useEffect, useState } from 'react';
import {
    IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonItem, IonLabel, IonNote
} from '@ionic/react';
import QRCode from 'qrcode';

/**
 * Invite sheet: QR code + copy-link + native share so friends can join a lobby
 * without typing a 36-character UUID.
 */
function ShareModal({ lobbyId, isOpen, onClose })
{
    const joinUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/lobby/${encodeURIComponent(lobbyId)}`
        : '';

    const [qrDataUrl, setQrDataUrl] = useState(null);
    const [copied, setCopied] = useState(false);
    const [idCopied, setIdCopied] = useState(false);

    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    // Render the QR to a data URL (offline, no network) whenever the URL changes
    useEffect(() => {
        let cancelled = false;
        if (!isOpen || !joinUrl) return undefined;

        QRCode.toDataURL(joinUrl, { width: 240, margin: 1, color: { dark: '#1a1a1a', light: '#ffffff' } })
            .then((url) => { if (!cancelled) setQrDataUrl(url); })
            .catch((error) => { console.error('Failed to render QR code:', error); });

        return () => { cancelled = true; };
    }, [isOpen, joinUrl]);

    async function copyToClipboard(text, setFlag)
    {
        try {
            await navigator.clipboard.writeText(text);
            setFlag(true);
            setTimeout(() => setFlag(false), 2000);
        } catch (error) {
            console.error('Clipboard write failed:', error);
        }
    }

    async function handleShare()
    {
        try {
            await navigator.share({
                title: 'Join my Manhunt lobby',
                text: 'Tap to join my Manhunt game:',
                url: joinUrl
            });
        } catch (error) {
            // AbortError just means the user dismissed the share sheet
            if (error?.name !== 'AbortError') {
                console.error('Share failed:', error);
            }
        }
    }

    return (
        <IonModal isOpen={isOpen} onDidDismiss={onClose} data-testid="share-modal">
            <IonHeader>
                <IonToolbar>
                    <IonTitle>Invite Players</IonTitle>
                    <IonButtons slot="end">
                        <IonButton data-testid="share-close" onClick={onClose}>Close</IonButton>
                    </IonButtons>
                </IonToolbar>
            </IonHeader>
            <IonContent className="ion-padding">
                <p className="ion-text-center">
                    Scan this QR code or share the link to join this lobby.
                </p>

                <div className="share-qr">
                    {qrDataUrl
                        ? <img data-testid="share-qr-img" src={qrDataUrl} alt="QR code to join the lobby" />
                        : <div className="share-qr-placeholder">Generating…</div>}
                </div>

                <div className="ion-margin-top">
                    {canShare && (
                        <IonButton data-testid="share-native" expand="block" onClick={handleShare}>
                            Share…
                        </IonButton>
                    )}
                    <IonButton
                        data-testid="share-copy"
                        expand="block"
                        color="success"
                        onClick={() => copyToClipboard(joinUrl, setCopied)}
                    >
                        {copied ? 'Link copied!' : 'Copy link'}
                    </IonButton>
                </div>

                <IonItem lines="none" className="ion-margin-top">
                    <IonLabel>
                        <IonNote>Lobby ID</IonNote>
                        <p className="share-id-value" data-testid="share-id">{lobbyId}</p>
                    </IonLabel>
                    <IonButton
                        data-testid="share-id-copy"
                        slot="end"
                        fill="outline"
                        size="small"
                        onClick={() => copyToClipboard(lobbyId, setIdCopied)}
                    >
                        {idCopied ? 'Copied' : 'Copy'}
                    </IonButton>
                </IonItem>
            </IonContent>
        </IonModal>
    );
}

export default ShareModal;
