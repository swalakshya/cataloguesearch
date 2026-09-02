import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ExternalLink } from 'lucide-react';

export default function AiDisclaimer({ className = '' }) {
    return (
        <div className={`card flex items-center justify-between gap-3 px-4 py-3 text-xs ${className}`}>
            <div className="flex items-start gap-2.5" style={{ color: 'var(--color-ink-muted)' }}>
                <ShieldCheck size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-brand)' }} />
                <span>Swalakshya Chat uses AI to generate answers.<br />Always refer to original scriptures and references.</span>
            </div>
            <Link
                to="/about"
                className="inline-flex items-center gap-1 font-medium whitespace-nowrap shrink-0"
                style={{ color: 'var(--color-brand)' }}
            >
                Learn more <ExternalLink size={12} />
            </Link>
        </div>
    );
}
