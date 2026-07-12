import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Invite sheet: QR code + copy-link + native share so friends can join a lobby
 * without typing a 36-character UUID. Reuses the shared modal classes.
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

    useEffect(() => {
        if (isOpen) {
            document.body.classList.add('modal-open');
        } else {
            document.body.classList.remove('modal-open');
        }
        return () => document.body.classList.remove('modal-open');
    }, [isOpen]);

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
        <div
            className={`modal-overlay ${isOpen ? 'modal-overlay-open' : ''}`}
            onClick={onClose}
            aria-hidden={!isOpen}
        >
            <div
                className={`modal-content share-modal modal-slide ${isOpen ? 'modal-slide-open' : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h2>Invite Players</h2>
                    <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
                </div>
                <div className="modal-body share-body">
                    <p className="share-instructions">
                        Scan this QR code or share the link to join this lobby.
                    </p>

                    <div className="share-qr">
                        {qrDataUrl
                            ? <img src={qrDataUrl} alt="QR code to join the lobby" width="240" height="240" />
                            : <div className="share-qr-placeholder">Generating…</div>}
                    </div>

                    <div className="share-actions">
                        {canShare && (
                            <button type="button" className="form-button primary" onClick={handleShare}>
                                Share…
                            </button>
                        )}
                        <button
                            type="button"
                            className="form-button secondary"
                            onClick={() => copyToClipboard(joinUrl, setCopied)}
                        >
                            {copied ? 'Link copied!' : 'Copy link'}
                        </button>
                    </div>

                    <div className="share-id-row">
                        <span className="share-id-label">Lobby ID</span>
                        <code className="share-id-value">{lobbyId}</code>
                        <button
                            type="button"
                            className="share-id-copy"
                            onClick={() => copyToClipboard(lobbyId, setIdCopied)}
                        >
                            {idCopied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ShareModal;
