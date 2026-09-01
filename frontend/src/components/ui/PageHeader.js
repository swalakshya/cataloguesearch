import React from 'react';

export default function PageHeader({ title, subtitle, className = '' }) {
    return (
        <div className={`mb-6 ${className}`}>
            <h1 className="text-2xl md:text-3xl font-bold text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-ink-muted">{subtitle}</p>}
        </div>
    );
}
