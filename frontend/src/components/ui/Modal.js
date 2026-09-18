import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
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
//
// closeOnBack (default true) gates the history.pushState/popstate part only.
// React Router patches window.history.pushState globally to detect
// navigations, so this raw pushState call -- even same-URL, state-only --
// registers as "the location changed" to it. Every current caller triggers
// from App.js, away from anything that reacts to location changes, so this
// has never been visibly a problem; a modal triggered from somewhere with
// its own location-sensitive effects (e.g. the chat page's session-loading
// logic, keyed off location.state) can have that phantom navigation trigger
// those effects and close the modal (or worse) the instant it opens. Pass
// closeOnBack={false} from a modal triggered in a context like that.
export function useOverlayBehavior(open, onClose, { closeOnBack = true } = {}) {
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
        if (!open || !closeOnBack) return;
        let poppedByUser = false;
        overlayStack.push(id);
        // Spread the EXISTING history.state in rather than replacing it
        // outright -- React Router keeps location.state (e.g. ChatPage's
        // remoteSessionId, used to load a session from history) in this
        // same history.state object. A bare `{ overlayId: id }` here used
        // to silently wipe it out from under React Router the instant any
        // modal opened anywhere the app has state-carrying navigation,
        // since pushState's state argument REPLACES the entry rather than
        // merging into it -- this was the actual root cause, not just
        // "React Router treats pushState as a navigation" (which is
        // unavoidable and fine on its own).
        window.history.pushState({ ...window.history.state, overlayId: id }, '');

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
    }, [open, id, closeOnBack]);
}

// Shared modal shell: overlay, escape-to-close, body-scroll lock, header+close
// button. accentColorVar (e.g. '--color-info') lets callers keep the existing
// per-content-type accent (verse/prose/teeka/etc.) without hardcoding a class.
export default function Modal({ open, onClose, title, size = 'md', accentColorVar, children, footer, closeOnBack = true }) {
    useOverlayBehavior(open, onClose, { closeOnBack });

    if (!open) return null;

    // Portaled to document.body: every existing caller of this component
    // triggers it from near the top of the tree (App.js), where escaping a
    // plain `position: fixed` to the viewport just works. A modal triggered
    // from deep inside the sidebar (sticky, overflow-hidden, its own
    // z-index stacking context) is a genuinely different situation -- a
    // descendant's z-index and fixed positioning are still evaluated within
    // whatever paint/stacking layer its ancestors put it in, so nesting can
    // silently swallow or misplace it even though nothing here looks wrong
    // in isolation. Rendering outside that tree entirely removes the
    // question instead of relying on every future caller happening to be
    // triggered from a "safe" spot in the DOM.
    return createPortal(
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
        </div>,
        document.body
    );
}
