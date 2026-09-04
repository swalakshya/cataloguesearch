import React from 'react';
import {
    cleanAnswerText,
    shouldCollapseAnswer,
    formatAnswerHtml,
    resolveChunkQuotes,
} from './answerFormatting';

// Renders one assistant message's answer body for response_format=structured:
// the inline blockquote/citation-card HTML (dangerouslySetInnerHTML, built by
// formatAnswerHtml) plus the show-more/less collapse toggle. Everything else
// about a message (the "ANSWER" header, follow-up chips, share/feedback row)
// is shared across formats and lives in ChatPage, not here.
export default function StructuredAnswer({ msg, displayedText, chunkTextsCache, expanded, onToggleExpand, onNavigateFeedback, onOpenReference }) {
    const fullyDisplayed = displayedText === cleanAnswerText(msg.content);
    const collapsible = fullyDisplayed && shouldCollapseAnswer(msg.content);

    const handleClick = (event) => {
        const target = event.target.closest('[data-app-action]');
        if (!target) return;
        const action = target.getAttribute('data-app-action');
        if (action === 'feedback') {
            onNavigateFeedback?.();
        } else if (action === 'view-pdf') {
            // No separate page field here — the URL is already page-suffixed by
            // buildQuoteMetaMarker; PdfCitationModal's resolveCitationTarget parses it back apart.
            onOpenReference?.({
                file_url: target.getAttribute('data-pdf-url') || '',
                category: target.getAttribute('data-category') || '',
                reference: target.getAttribute('data-category') || '',
            });
        }
    };

    const html = formatAnswerHtml(
        resolveChunkQuotes(
            displayedText !== undefined ? displayedText : msg.content || '',
            msg.citations,
            chunkTextsCache
        ),
        msg.citationBlocks
    );

    return (
        <div className="max-w-[860px]">
            <div
                className={`text-ink leading-relaxed text-base ${collapsible && !expanded ? 'max-h-72 overflow-hidden' : ''}`}
                onClick={handleClick}
                dangerouslySetInnerHTML={{ __html: html }}
            />
            {collapsible && (
                <button
                    onClick={onToggleExpand}
                    className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-hover transition-colors"
                >
                    {expanded ? 'Show less' : 'Show more'}
                </button>
            )}
        </div>
    );
}
