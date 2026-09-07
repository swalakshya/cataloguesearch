import React from 'react';
import {
    cleanAnswerText,
    shouldCollapseAnswer,
    formatAnswerHtml,
    resolveChunkQuotes,
    findCitationByChunkId,
    buildReferencePdfUrl,
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
            // Layer multiple sources, least to most authoritative — no single one is
            // guaranteed complete:
            //   1. the button's own data-attributes: always present (built straight from
            //      the marker), but only ever category + a page-suffixed file_url.
            //   2. chunkTextsCache[chunkId] (GET /api/chunk/{id}, fetched to render the
            //      on-screen blockquote text): has granth/category/author/volume/series/
            //      verse-locators — but NOT file_url or pravachankar, that endpoint never
            //      returns them. Only applies to the {{chunk_id}} blockquote path.
            //   3. msg.citations, matched by chunk_id when available (the {{chunk_id}}
            //      blockquote path) or, failing that, by the citation's own page-suffixed
            //      file_url (the <citation>-tag path — that tag format comes from the
            //      separate LLM chat service (LLM_API_BASE_URL), which never emits a
            //      chunk_id attribute on it, so file_url is the only correlation key
            //      available there). Whichever way it's found, this is the fullest object:
            //      same one Summary mode's reference badges use, includes pravachankar and
            //      a clean file_url/pdf_page_number.
            // No separate page field needed when only (1) applies — the URL is already
            // page-suffixed by buildQuoteMetaMarker; PdfCitationModal's
            // resolveCitationTarget parses it back apart.
            const chunkId = target.getAttribute('data-chunk-id') || '';
            const rawPdfUrl = target.getAttribute('data-pdf-url') || '';
            const fromDataAttrs = {
                file_url: rawPdfUrl,
                category: target.getAttribute('data-category') || '',
                reference: target.getAttribute('data-category') || '',
            };
            const fromChunkCache = chunkId ? chunkTextsCache?.[chunkId] : null;
            const fromCitationsById = chunkId ? findCitationByChunkId(msg.citations, chunkId) : null;
            const fromCitationsByUrl = !fromCitationsById && rawPdfUrl
                ? (msg.citations || []).find(
                    c => buildReferencePdfUrl(c.file_url, c.pdf_page_number, c.page_number) === rawPdfUrl
                  ) || null
                : null;
            const fullCitation = fromCitationsById || fromCitationsByUrl;
            onOpenReference?.({ ...fromDataAttrs, ...(fromChunkCache || {}), ...(fullCitation || {}) });
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
