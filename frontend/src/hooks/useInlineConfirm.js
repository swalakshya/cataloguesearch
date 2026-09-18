import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_TIMEOUT_MS = 4000;

// Shared "click -> inline confirm -> auto-revert" state machine, used in
// place of window.confirm() so a destructive action gets a non-blocking,
// in-place confirm UI instead of a native dialog. Callers render their own
// confirm UI (a bare icon swapping to check/cancel, or a dropdown menu item
// swapping to "Are you sure?" text buttons look nothing alike) but share
// the same behavior: idle auto-revert, explicit cancel, and reverting on an
// outside click -- attach `containerRef` to whatever DOM node wraps the
// confirm UI for that last part to work.
export function useInlineConfirm(onConfirm, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const [confirming, setConfirming] = useState(false);
    const timerRef = useRef(null);
    const containerRef = useRef(null);

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const cancel = useCallback(() => {
        clearTimer();
        setConfirming(false);
    }, [clearTimer]);

    const requestConfirm = useCallback(() => {
        setConfirming(true);
        clearTimer();
        timerRef.current = setTimeout(() => setConfirming(false), timeoutMs);
    }, [clearTimer, timeoutMs]);

    const confirm = useCallback(() => {
        clearTimer();
        setConfirming(false);
        return onConfirm();
    }, [clearTimer, onConfirm]);

    useEffect(() => clearTimer, [clearTimer]);

    useEffect(() => {
        if (!confirming) return undefined;
        const onClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) cancel();
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [confirming, cancel]);

    return { confirming, requestConfirm, confirm, cancel, containerRef };
}
