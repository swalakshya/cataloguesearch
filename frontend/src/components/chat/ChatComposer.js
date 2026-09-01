import React from 'react';
import { SendHorizontal } from 'lucide-react';
import { SearchBar } from '../SearchInterface';
import { Spinner } from '../SharedComponents';
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

    return (
        <div className="w-full">
            <div
                className="rounded-xl shadow-md transition-colors"
                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
            >
                <div className="flex items-center gap-2 pl-1 pr-1.5 py-1.5">
                    <div className="flex-grow">
                        <SearchBar
                            query={query}
                            setQuery={setQuery}
                            onSearch={() => canSend && onSend()}
                            language={language}
                            disabled={disabled}
                            bare
                            placeholder={placeholder}
                        />
                    </div>
                    <button
                        onClick={onSend}
                        disabled={!canSend}
                        className="btn btn-primary h-10 w-10 rounded-full p-0 shrink-0"
                        aria-label="Send"
                    >
                        {loading ? <Spinner /> : <SendHorizontal size={18} strokeWidth={2.5} />}
                    </button>
                </div>
            </div>
            <div className={compact ? 'mt-2' : 'mt-3'}>
                <ChatFilters
                    activeCategories={activeCategories}
                    debugMode={debugMode}
                    chatContentTypes={chatContentTypes}
                    setChatContentTypes={setChatContentTypes}
                    compact={compact}
                />
            </div>
            {showDisclaimer && <AiDisclaimer className="mt-2" />}
        </div>
    );
}
