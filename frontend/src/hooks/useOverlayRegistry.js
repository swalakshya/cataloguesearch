import { useEffect, useSyncExternalStore } from 'react';

// Single global "how many overlays are open" counter. Every modal, popup, and
// filter sheet in the app registers here (mostly via useOverlayBehavior in
// ui/Modal.js) so that unrelated UI — like the mobile Home/Feedback FABs in
// App.js — can ask "is anything covering the screen right now?" with one
// hook, instead of every overlay needing to be threaded into a bespoke flag.
let count = 0;
const listeners = new Set();

function notify() {
    listeners.forEach((listener) => listener());
}

function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getSnapshot() {
    return count > 0;
}

// Register while `isOpen` is true; safe to call unconditionally every render.
export function useRegisterOverlay(isOpen) {
    useEffect(() => {
        if (!isOpen) return;
        count += 1;
        notify();
        return () => {
            count -= 1;
            notify();
        };
    }, [isOpen]);
}

export function useAnyOverlayOpen() {
    return useSyncExternalStore(subscribe, getSnapshot);
}
