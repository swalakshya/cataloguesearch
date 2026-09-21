import { useEffect } from 'react';

/**
 * Adds left/right arrow key navigation to any pane.
 * Skips when focus is on an input, textarea, or select so jump fields work normally.
 *
 * @param {function} onPrev - called on ArrowLeft
 * @param {function} onNext - called on ArrowRight
 * @param {boolean}  enabled - set false to disable (e.g. when no file is loaded)
 */
const useArrowNavigation = (onPrev, onNext, enabled = true) => {
    useEffect(() => {
        if (!enabled) return;

        const handler = (e) => {
            const tag = document.activeElement?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            if (e.key === 'ArrowLeft')  { e.preventDefault(); onPrev(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onPrev, onNext, enabled]);
};

export default useArrowNavigation;
