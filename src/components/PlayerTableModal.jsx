import { useEffect } from 'react';
import PlayerTable from './PlayerTable';

function PlayerTableModal({ players, currentPlayer, isOpen, onClose }) {
    useEffect(() => {
        if (isOpen) {
            document.body.classList.add('modal-open');
        } else {
            document.body.classList.remove('modal-open');
        }

        return () => {
            document.body.classList.remove('modal-open');
        };
    }, [isOpen]);

    return (
        <div
            className={`modal-overlay ${isOpen ? 'modal-overlay-open' : ''}`}
            onClick={onClose}
            aria-hidden={!isOpen}
        >
            <div
                className={`modal-content modal-slide ${isOpen ? 'modal-slide-open' : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h2>Players in Lobby</h2>
                    <button 
                        className="modal-close-btn"
                        onClick={onClose}
                        aria-label="Close modal"
                    >
                        ×
                    </button>
                </div>
                <div className="modal-body">
                    <PlayerTable players={players} currentPlayer={currentPlayer} />
                </div>
            </div>
        </div>
    );
}

export default PlayerTableModal;
