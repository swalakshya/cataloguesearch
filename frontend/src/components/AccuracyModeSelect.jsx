import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

// Shared by Khoj and both chat composers; only the parent owns the selected level.
export default function AccuracyModeSelect({ accuracyMode = false, onChange, disabled = false }) {
    const [open, setOpen] = useState(false);
    const popupId = useId();
    const rootRef = useRef(null);
    const buttonRef = useRef(null);
    const sliderRef = useRef(null);
    const level = accuracyMode ? 'High' : 'Low';
    useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
    useEffect(() => {
        if (!open) return;
        sliderRef.current?.focus();
        const dismiss = (event) => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        const escape = (event) => {
            if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
        };
        document.addEventListener('pointerdown', dismiss);
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('pointerdown', dismiss);
            document.removeEventListener('keydown', escape);
        };
    }, [open]);
    return (
        <div ref={rootRef} className="relative shrink-0"
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
            <button ref={buttonRef} type="button" aria-label="Search effort" aria-expanded={open}
                aria-controls={open ? popupId : undefined} aria-haspopup="dialog" disabled={disabled}
                onClick={() => setOpen(!open)} title="Search effort: High searches more passages and may take longer."
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-ink-muted transition-colors enabled:hover:bg-border enabled:hover:text-ink focus-visible:bg-border focus-visible:outline-brand disabled:cursor-default ${open ? 'bg-border' : ''}`}>
                {level}<ChevronDown size={16} className="shrink-0" aria-hidden="true" />
            </button>
            {open && <div id={popupId} role="dialog" aria-label="Search effort"
                className="absolute bottom-full right-0 mb-2 z-50 w-56 rounded-xl border border-border bg-surface p-4 shadow-lg">
                <div className="text-xs font-medium text-ink-muted text-center">Search effort</div>
                <div className="mt-1 mb-3 text-center text-lg font-semibold text-ink">{level}</div>
                <input ref={sliderRef} type="range" min="0" max="1" step="1" value={accuracyMode ? 1 : 0}
                    aria-label="Search effort level" aria-valuetext={level}
                    onChange={(event) => onChange(event.target.value === '1')}
                    className="block w-full cursor-pointer focus-visible:outline-brand" style={{ accentColor: 'var(--color-brand)' }} />
                <div className="mt-1 flex justify-between text-xs text-ink-muted"><span>Low</span><span>High</span></div>
                <p className="mt-3 text-xs text-ink-muted">High searches more passages and may take longer.</p>
            </div>}
        </div>
    );
}
