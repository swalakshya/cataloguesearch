import React from 'react';
import { X } from 'lucide-react';

// Backdrop + "click on it closes, click inside the card doesn't" wiring,
// shared by every overlay whose shape is too custom for the full <Modal>
// shell (a resizable PDF viewer, a responsive bottom-sheet-on-mobile filter
// panel, ...) — so the part that's easy to forget by hand (outside-click-to-
// close) is centralized here instead of copy-pasted per component. Visual
// shape (backdrop alignment, card size, mobile vs desktop layout) stays
// fully up to the caller via className/style, only the two behavioral
// pieces — dimming + click-outside — are fixed.
export function OverlayBackdrop({ onClose, className = '', contentClassName = '', contentStyle, children }) {
    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center ${className}`}
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={onClose}
        >
            <div className={contentClassName} style={contentStyle} onClick={(e) => e.stopPropagation()}>
                {children}
            </div>
        </div>
    );
}

// Small "X" close button, shared so every overlay's close affordance looks
// and behaves the same (icon, hover color, aria-label) without hand-copying it.
export function CloseButton({ onClick, size = 20, className = '' }) {
    return (
        <button
            onClick={onClick}
            aria-label="Close"
            className={`text-ink-muted hover:text-ink shrink-0 flex items-center justify-center ${className}`}
        >
            <X size={size} />
        </button>
    );
}
