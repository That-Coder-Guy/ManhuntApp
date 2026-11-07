import { useCallback, useEffect, useRef, useState } from 'react';
import {
    IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonNote, IonSpinner
} from '@ionic/react';
import jsQR from 'jsqr';

// Decoding every animation frame drains the battery for nothing — a hand-held
// phone can't present a new code faster than this.
const SCAN_INTERVAL_MS = 150;

// Frames are downscaled to this longest edge before decoding: plenty of detail
// for a QR code, and it keeps each pass cheap on a phone.
const MAX_DECODE_EDGE = 640;

const SCAN_STATUS = {
    STARTING: 'starting',
    SCANNING: 'scanning',
    UNSUPPORTED: 'unsupported',
    DENIED: 'denied',
    ERROR: 'error'
};

const STATUS_MESSAGES = {
    [SCAN_STATUS.UNSUPPORTED]: "This browser can't open the camera here. Camera access needs a secure (https) connection.",
    [SCAN_STATUS.DENIED]: 'Camera access was blocked. Allow the camera for this site, then try again.',
    [SCAN_STATUS.ERROR]: "Couldn't start the camera. Close anything else using it and try again."
};

/**
 * Camera viewfinder that reads a lobby invite QR code and hands the decoded
 * text back to the caller. The stream is opened when the sheet finishes
 * presenting and torn down on dismiss, so the camera is never left running.
 */
function QrScanModal({ isOpen, onClose, onScan })
{
    const [status, setStatus] = useState(SCAN_STATUS.STARTING);

    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const canvasRef = useRef(null);
    const timerRef = useRef(null);
    // One scan per session: the decode loop can match the same code twice
    // before the sheet has finished closing.
    const hasScannedRef = useRef(false);
    // Bumped on every start and stop. A permission prompt can still be open
    // when the sheet is dismissed, and the resolved stream has to be able to
    // tell that nobody is waiting for it any more.
    const sessionRef = useRef(0);

    const stopCamera = useCallback(() =>
    {
        sessionRef.current += 1;

        if (timerRef.current)
        {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        if (streamRef.current)
        {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }

        const video = videoRef.current;
        if (video)
        {
            video.srcObject = null;
        }
    }, []);

    const readFrame = useCallback(() =>
    {
        const video = videoRef.current;
        if (!video || hasScannedRef.current) return;
        if (video.readyState < video.HAVE_CURRENT_DATA) return;

        const { videoWidth, videoHeight } = video;
        if (!videoWidth || !videoHeight) return;

        if (!canvasRef.current)
        {
            canvasRef.current = document.createElement('canvas');
        }
        const canvas = canvasRef.current;

        const scale = Math.min(1, MAX_DECODE_EDGE / Math.max(videoWidth, videoHeight));
        const width = Math.round(videoWidth * scale);
        const height = Math.round(videoHeight * scale);
        if (canvas.width !== width || canvas.height !== height)
        {
            canvas.width = width;
            canvas.height = height;
        }

        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(video, 0, 0, width, height);

        const frame = context.getImageData(0, 0, width, height);
        // Invite codes are always dark-on-light, so skip the inverted pass
        const result = jsQR(frame.data, width, height, { inversionAttempts: 'dontInvert' });
        if (!result?.data) return;

        hasScannedRef.current = true;
        stopCamera();
        onScan(result.data);
    }, [onScan, stopCamera]);

    const startCamera = useCallback(async () =>
    {
        if (streamRef.current) return;

        const session = ++sessionRef.current;
        hasScannedRef.current = false;
        setStatus(SCAN_STATUS.STARTING);

        // Undefined on insecure origins (plain http over the LAN, for one)
        if (!navigator.mediaDevices?.getUserMedia)
        {
            setStatus(SCAN_STATUS.UNSUPPORTED);
            return;
        }

        try
        {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });

            // Dismissed, or restarted, while permission was pending
            if (session !== sessionRef.current)
            {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            streamRef.current = stream;
            const video = videoRef.current;
            if (video)
            {
                video.srcObject = stream;
                await video.play();
            }

            setStatus(SCAN_STATUS.SCANNING);
            timerRef.current = setInterval(readFrame, SCAN_INTERVAL_MS);
        }
        catch (error)
        {
            console.error('Failed to start the camera:', error);
            const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
            setStatus(denied ? SCAN_STATUS.DENIED : SCAN_STATUS.ERROR);
        }
    }, [readFrame]);

    // Never leave the camera on if this unmounts while the sheet is open
    useEffect(() => stopCamera, [stopCamera]);

    const message = STATUS_MESSAGES[status];

    return (
        <IonModal
            isOpen={isOpen}
            /* willPresent, not didPresent: the video element is already mounted
               here, so the camera warms up during the sheet's slide-in instead
               of only starting once it has finished. */
            onWillPresent={startCamera}
            onWillDismiss={stopCamera}
            onDidDismiss={onClose}
            data-testid="qr-scan-modal"
        >
            <IonHeader>
                <IonToolbar>
                    <IonTitle>Scan invite</IonTitle>
                    <IonButtons slot="end">
                        <IonButton data-testid="qr-scan-close" onClick={onClose}>Close</IonButton>
                    </IonButtons>
                </IonToolbar>
            </IonHeader>
            <IonContent className="ion-padding">
                <div className="qr-viewfinder" data-testid="qr-viewfinder">
                    <video
                        ref={videoRef}
                        className="qr-viewfinder-video"
                        playsInline
                        muted
                        autoPlay
                    />
                    {status === SCAN_STATUS.SCANNING && <div className="qr-viewfinder-reticle" />}
                    {status === SCAN_STATUS.STARTING && (
                        <div className="qr-viewfinder-overlay">
                            <IonSpinner name="crescent" />
                        </div>
                    )}
                    {message && (
                        <div className="qr-viewfinder-overlay">
                            <p className="qr-viewfinder-message" data-testid="qr-scan-error">{message}</p>
                        </div>
                    )}
                </div>

                {status === SCAN_STATUS.SCANNING && (
                    <IonNote className="qr-scan-hint">
                        Point the camera at the invite QR code
                    </IonNote>
                )}

                {(status === SCAN_STATUS.DENIED || status === SCAN_STATUS.ERROR) && (
                    <IonButton
                        data-testid="qr-scan-retry"
                        expand="block"
                        className="ion-margin-top"
                        onClick={startCamera}
                    >
                        Try again
                    </IonButton>
                )}
            </IonContent>
        </IonModal>
    );
}

export default QrScanModal;
