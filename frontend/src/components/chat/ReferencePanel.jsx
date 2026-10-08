import React, { useState } from 'react';
import { ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import { buildReferenceLines } from './answerFormatting';
import { CategoryEmojiIcon } from './categoryEmoji';

// The trailing reference list for a summary-mode answer — lives at the very
// end of a message (after follow-ups and the share/feedback row), collapsed
// by default. No link/URL text in a row: the row itself is the click target
// that opens PdfCitationModal, so showing the raw URL would just be visual
// noise for something that isn't the way you'd actually use it.
export default function ReferencePanel({ citations, onOpenReference }) {
    const [expanded, setExpanded] = useState(false);
    const list = Array.isArray(citations) ? citations : [];
    const resolved = list.filter((c) => c && c.file_url);
    if (resolved.length === 0) return null;

    return (
        <div className="mt-4 w-full max-w-[860px] rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink-muted"
            >
                <BookOpen size={15} style={{ color: 'var(--color-brand)' }} />
                <span className="font-medium text-ink">{resolved.length} reference{resolved.length === 1 ? '' : 's'}</span>
                <span className="ml-auto">{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
            </button>
            {expanded && list.map((citation, idx) => {
                if (!citation || !citation.file_url) return null;
                const { title, subtitle } = buildReferenceLines(citation);
                return (
                    <button
                        type="button"
                        key={citation.chunk_id || idx}
                        onClick={() => onOpenReference?.(citation)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left border-t"
                        style={{ borderColor: 'var(--color-border)' }}
                    >
                        <span
                            className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs"
                            style={{ border: '1px solid var(--color-border)', color: 'var(--color-ink-muted)' }}
                        >
                            {idx + 1}
                        </span>
                        <CategoryEmojiIcon category={citation.category} size={16} className="shrink-0" />
                        <span className="flex-1 min-w-0">
                            <div className="truncate text-ink">{title}</div>
                            {subtitle && <div className="truncate text-xs text-ink-muted">{subtitle}</div>}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
