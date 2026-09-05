import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ExternalLink } from 'lucide-react';

export default function AiDisclaimer({ className = '' }) {
    return (
        <div className={`card px-3 py-1.5 text-[11px] leading-snug ${className}`} style={{ color: 'var(--color-ink-muted)' }}>
            <ShieldCheck size={14} className="inline-block mr-1.5 mb-0.5 flex-shrink-0" style={{ color: 'var(--color-brand)' }} />
            AI generated answers can make mistakes. Always clarify with original scriptures and references!{' '}
            <Link
                to="/about"
                aria-label="Learn more"
                className="inline-flex align-middle"
                style={{ color: 'var(--color-brand)' }}
            >
                <ExternalLink size={11} />
            </Link>
        </div>
    );
}
