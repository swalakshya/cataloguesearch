import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, totalPages, onPageChange, className = '' }) {
    if (!totalPages || totalPages <= 1) return null;

    const pages = [];
    const windowSize = 2;
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - page) <= windowSize) {
            pages.push(p);
        } else if (pages[pages.length - 1] !== '…') {
            pages.push('…');
        }
    }

    return (
        <nav className={`flex items-center gap-1 ${className}`} aria-label="Pagination">
            <button
                className="btn btn-ghost"
                style={{ padding: '0.4rem' }}
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
            >
                <ChevronLeft size={16} />
            </button>
            {pages.map((p, i) => (
                p === '…' ? (
                    <span key={`ellipsis-${i}`} className="px-2 text-ink-muted">…</span>
                ) : (
                    <button
                        key={p}
                        onClick={() => onPageChange(p)}
                        className="btn"
                        style={{
                            padding: '0.4rem 0.7rem',
                            backgroundColor: p === page ? 'var(--color-brand)' : 'var(--color-surface)',
                            color: p === page ? '#fff' : 'var(--color-ink)',
                            border: '1px solid var(--color-border)',
                        }}
                    >
                        {p}
                    </button>
                )
            ))}
            <button
                className="btn btn-ghost"
                style={{ padding: '0.4rem' }}
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
            >
                <ChevronRight size={16} />
            </button>
        </nav>
    );
}
