import React, { useEffect, useRef, useState } from 'react';
import { SendHorizontal, SlidersHorizontal } from 'lucide-react';
import { SearchBar } from '../SearchInterface';
import { Spinner } from '../SharedComponents';
import { InputActionBar } from '../ui';
import ChatFilters from './ChatFilters';
import AiDisclaimer from './AiDisclaimer';

// The chat input group used both in the empty-state hero and the active-chat
// sticky bar — one component so the two stay visually identical instead of
// drifting apart as hand-duplicated JSX. New Chat lives in the sidebar now
// (Phase 3), so this owns: input, send button, filter chips, and (optionally)
// the disclaimer — the empty-state hero places its own disclaimer after the
// stats strip instead, per the mock, so it opts out with showDisclaimer=false.
export default function ChatComposer({
    query,
    setQuery,
    onSend,
    language,
    disabled = false,
    loading = false,
    activeCategories,
    debugMode,
    chatContentTypes,
    setChatContentTypes,
    placeholder = 'Ask anything about Jain philosophy, scriptures, or teachings...',
    showDisclaimer = true,
    // Large standalone category tiles (matching the mock) fit the spacious
    // empty-state hero; the active-chat sticky footer is space-constrained and
    // persistent while scrolling, so it opts into the smaller pill treatment.
    compact = false,
}) {
    const canSend = query.trim().length > 0 && !disabled;

    // Compact (active-chat) mode keeps the pinned bar to a single row: the
    // category filters live behind a button that opens a small popover, with a
    // dot on the button whenever the selection differs from "everything on"
    // so a narrowed search never hides silently.
    const [filtersOpen, setFiltersOpen] = useState(false);
    const popoverRef = useRef(null);
    useEffect(() => {
        if (!filtersOpen) return undefined;
        const onDown = (e) => { if (!popoverRef.current?.contains(e.target)) setFiltersOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setFiltersOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [filtersOpen]);
    const narrowed = chatContentTypes.length < activeCategories.length;

    const filters = (
        <ChatFilters
            activeCategories={activeCategories}
            debugMode={debugMode}
            chatContentTypes={chatContentTypes}
            setChatContentTypes={setChatContentTypes}
            compact={compact}
        />
    );

    return (
        <div className="w-full relative" ref={popoverRef}>
            {compact && filtersOpen && (
                <div
                    className="absolute bottom-full left-0 right-0 mb-2 rounded-xl shadow-lg px-3 py-2.5 z-30"
                    style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                >
                    {filters}
                </div>
            )}
            <InputActionBar
                action={
                    <div className="flex items-center gap-1.5 shrink-0">
                        {compact && (
                            <button
                                type="button"
                                onClick={() => setFiltersOpen((o) => !o)}
                                aria-label="Filter by category"
                                aria-expanded={filtersOpen}
                                title="Filter by category"
                                className="relative h-10 w-10 rounded-full flex items-center justify-center transition-colors hover:bg-bg"
                                style={{ color: narrowed || filtersOpen ? 'var(--color-brand)' : 'var(--color-ink-muted)' }}
                            >
                                <SlidersHorizontal size={18} />
                                {narrowed && (
                                    <span
                                        className="absolute top-2 right-2 h-2 w-2 rounded-full"
                                        style={{ backgroundColor: 'var(--color-brand)', boxShadow: '0 0 0 2px var(--color-surface)' }}
                                    />
                                )}
                            </button>
                        )}
                        <button
                            onClick={onSend}
                            disabled={!canSend}
                            className="btn btn-primary h-10 w-10 rounded-full p-0 shrink-0"
                            aria-label="Send"
                        >
                            {loading ? <Spinner /> : <SendHorizontal size={18} strokeWidth={2.5} />}
                        </button>
                    </div>
                }
            >
                <SearchBar
                    query={query}
                    setQuery={setQuery}
                    onSearch={() => canSend && onSend()}
                    language={language}
                    disabled={disabled}
                    bare
                    placeholder={placeholder}
                />
            </InputActionBar>
            {!compact && <div className="mt-3">{filters}</div>}
            {showDisclaimer && <AiDisclaimer className="mt-1.5" />}
        </div>
    );
}
