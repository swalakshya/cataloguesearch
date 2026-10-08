import React from 'react';

// 'hero' matches the big centered treatment used on the chat/home empty
// state (large bold title + muted, width-capped subtitle) — reused wherever
// a page wants that same visual weight instead of a plain left-aligned title.
export default function PageHeader({ title, subtitle, className = '', variant = 'default' }) {
    if (variant === 'hero') {
        return (
            <div className={`text-center mb-10 ${className}`}>
                <h1
                    className="text-4xl font-bold tracking-tight"
                    style={{
                        background: 'linear-gradient(to right, var(--color-brand), var(--color-mark))',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        color: 'transparent',
                    }}
                >
                    {title}
                </h1>
                {subtitle && <p className="mt-2 text-ink-muted max-w-xl mx-auto whitespace-pre-line">{subtitle}</p>}
            </div>
        );
    }

    return (
        <div className={`mb-6 ${className}`}>
            <h1 className="text-2xl md:text-3xl font-bold text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-ink-muted">{subtitle}</p>}
        </div>
    );
}
