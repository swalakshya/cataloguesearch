import { useEffect, useRef } from 'react';

// Shared "close this popover on an outside click or Escape" behavior --
// previously hand-rolled independently in TopBar.js's NavigateDropdown and
// Sidebar.js's HistoryRowMenu, identical except for how many refs count as
// "inside" (a dropdown whose trigger button and panel share one wrapping
// ref only needs one; a menu whose trigger is a separate sibling element,
// like HistoryRowMenu's three-dot button, needs that ref included too, or
// clicking the trigger while open fights its own onClick handler).
//
// refs/onOutsideClick/options are read from refs on every call, not put in
// the effect's dependency array, so passing a fresh inline array or
// function each render (the normal case) never tears down and re-adds the
// document listeners for no reason.
export function useOutsideClick(refs, onOutsideClick, { enabled = true, closeOnEscape = true } = {}) {
    const refsRef = useRef(refs);
    refsRef.current = refs;
    const callbackRef = useRef(onOutsideClick);
    callbackRef.current = onOutsideClick;

    useEffect(() => {
        if (!enabled) return undefined;

        const isInside = (target) => {
            const list = Array.isArray(refsRef.current) ? refsRef.current : [refsRef.current];
            return list.some((ref) => ref?.current && ref.current.contains(target));
        };
        const onClickOutside = (e) => {
            if (!isInside(e.target)) callbackRef.current(e);
        };
        const onKeyDown = (e) => {
            if (closeOnEscape && e.key === 'Escape') callbackRef.current(e);
        };

        document.addEventListener('mousedown', onClickOutside);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onClickOutside);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [enabled, closeOnEscape]);
}
