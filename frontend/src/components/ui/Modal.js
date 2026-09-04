import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useRegisterOverlay } from '../../hooks/useOverlayRegistry';

const SIZE_CLASS = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
};

// Escape-to-close + body-scroll lock + global overlay registration, shared by
// Modal and any other overlay (mobile sidebar drawer, PdfCitationModal, the
// legacy hand-rolled modals in Modals.js, etc.) so this behavior — including
// "something is covering the screen" for useAnyOverlayOpen() — only lives here.
export function useOverlayBehavior(open, onClose) {
    useRegisterOverlay(open);

    useEffect(() => {
        if (!open) return;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [open, onClose]);
}

// Shared modal shell: overlay, escape-to-close, body-scroll lock, header+close
// button. accentColorVar (e.g. '--color-info') lets callers keep the existing
// per-content-type accent (verse/prose/teeka/etc.) without hardcoding a class.
export default function Modal({ open, onClose, title, size = 'md', accentColorVar, children, footer }) {
    useOverlayBehavior(open, onClose);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={onClose}
        >
            <div
                className={`card w-full ${SIZE_CLASS[size] || SIZE_CLASS.md} max-h-[90vh] flex flex-col shadow-2xl`}
                style={accentColorVar ? { borderTop: `3px solid var(${accentColorVar})` } : undefined}
                onClick={(e) => e.stopPropagation()}
            >
                {(title || onClose) && (
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                        <h2 className="text-lg font-semibold text-ink">{title}</h2>
                        <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="Close">
                            <X size={20} />
                        </button>
                    </div>
                )}
                <div className="px-5 py-4 overflow-y-auto">{children}</div>
                {footer && <div className="px-5 py-4 border-t border-border shrink-0">{footer}</div>}
            </div>
        </div>
    );
}
