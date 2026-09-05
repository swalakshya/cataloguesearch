import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useRegisterOverlay } from '../../hooks/useOverlayRegistry';

const SIZE_CLASS = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
};

// Order in which currently-open overlays pushed a history entry (see below).
// Module-level so a mobile back-press only closes the topmost overlay when
// several are stacked, even though popstate fires for every listener at once.
const overlayStack = [];

// Escape-to-close + body-scroll lock + mobile-back-closes-overlay + global
// overlay registration, shared by Modal and any other overlay (mobile sidebar
// drawer, PdfCitationModal, the legacy hand-rolled modals in Modals.js, etc.)
// so this behavior — including "something is covering the screen" for
// useAnyOverlayOpen() — only lives here.
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

    // Keep the latest onClose without re-running the history effect below on
    // every render — callers rarely memoize onClose, and re-running it would
    // push a duplicate history entry each time.
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; });

    const id = useId();

    useEffect(() => {
        if (!open) return;
        let poppedByUser = false;
        overlayStack.push(id);
        window.history.pushState({ overlayId: id }, '');

        const handlePopState = () => {
            // Several overlays can be open at once (e.g. a citation modal on
            // top of the sidebar drawer); only the topmost should react to a
            // single back-press, since popstate fires for every listener.
            if (overlayStack[overlayStack.length - 1] !== id) return;
            poppedByUser = true;
            overlayStack.pop();
            onCloseRef.current();
        };
        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            if (poppedByUser) return;
            const idx = overlayStack.lastIndexOf(id);
            if (idx !== -1) overlayStack.splice(idx, 1);
            // Closed some other way (X, overlay click, Escape) — consume our
            // own dummy entry so a later real back-press isn't swallowed by
            // it. Only if it's still the current entry: a real navigation may
            // have pushed its own entry on top since (e.g. a route change
            // that unmounts this overlay), in which case back() here would
            // wrongly undo that navigation instead.
            if (window.history.state && window.history.state.overlayId === id) {
                window.history.back();
            }
        };
    }, [open, id]);
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
