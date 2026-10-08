import React from 'react';

// Shared "pill" input row: a bordered/surface container with the input
// filling the width and an action button (send icon, Search label, ...)
// docked inline at the right edge — one component so the chat composer and
// the classic search bar render the exact same shell instead of drifting.
//
// `footer` is optional (only the chat composer's filter row uses it): folded
// into the same card below a divider, instead of floating as its own
// separate element under the search bar — so filters read as part of the
// search action they affect, not an unrelated third row.
export default function InputActionBar({ children, action, footer, className = '' }) {
    return (
        <div
            className={`rounded-xl shadow-md transition-colors ${className}`}
            style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
            <div className="flex items-center gap-2 pl-1 pr-1.5 py-1.5">
                <div className="flex-grow min-w-0">{children}</div>
                {action}
            </div>
            {footer && (
                <div className="px-3 py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                    {footer}
                </div>
            )}
        </div>
    );
}
