import React from 'react';

// Shared "pill" input row: a bordered/surface container with the input
// filling the width and an action button (send icon, Search label, ...)
// docked inline at the right edge — one component so the chat composer and
// the classic search bar render the exact same shell instead of drifting.
export default function InputActionBar({ children, action, className = '' }) {
    return (
        <div
            className={`rounded-xl shadow-md transition-colors ${className}`}
            style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
            <div className="flex items-center gap-2 pl-1 pr-1.5 py-1.5">
                <div className="flex-grow min-w-0">{children}</div>
                {action}
            </div>
        </div>
    );
}
