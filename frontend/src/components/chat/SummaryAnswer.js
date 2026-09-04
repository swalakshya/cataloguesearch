import React from 'react';
import { cleanAnswerText, shouldCollapseAnswer } from './answerFormatting';

const SUMMARY_MARKER_PATTERN = /\(@@_(\d+)\)/g;

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Lighter-weight than answerFormatting's formatAnswerHtml on purpose: summary
// mode's prompt forbids blockquotes and full <citation> tags, so there's
// nothing here to tokenize besides basic WhatsApp-style markdown (bold,
// italic, inline code, bulleted lines) plus the (@@_N) citation markers this
// mode uses instead. See step_2_answer_synthesis_summary.md for the contract.
function formatSummaryHtml(answerText, citations) {
    if (!answerText) return '';
    const boldParts = [];
    const italicParts = [];
    const codeParts = [];

    let text = cleanAnswerText(answerText);

    // Pull (@@_N) markers out FIRST, before any WhatsApp-style tokenization.
    // The _italic_ extraction below just hunts for the next underscore with
    // no idea some of them belong to markers — two markers close together
    // (e.g. "(@@_1) (@@_2)") would otherwise get matched as one italic span
    // from the first marker's underscore to the second's, destroying both.
    // No underscore anywhere in this placeholder — the _italic_ regex right
    // below cross-matches between ANY two underscores it finds with no idea
    // what put them there, so an underscore in the placeholder itself would
    // reintroduce the exact same bug one layer down (as happened here once already).
    text = text.replace(SUMMARY_MARKER_PATTERN, (match, numStr) => `@@SUMREFMARK${numStr}ENDMARK@@`);

    text = text.replace(/_([^_\n]+?)_/g, (match, content) => {
        italicParts.push(content);
        return `__ITAL_${italicParts.length - 1}__`;
    });
    text = text.replace(/(?<!`)`([^`\n]+)`(?!`)/g, (match, content) => {
        codeParts.push(content);
        return `__CODE_${codeParts.length - 1}__`;
    });
    text = text.replace(/\*([^*\n]+?)\*/g, (match, content) => {
        boldParts.push(content);
        return `__BOLD_${boldParts.length - 1}__`;
    });

    text = escapeHtml(text);
    text = text.replace(/\n{3,}/g, '\n\n');

    // Bulleted lines ("- item") get a visual bullet; everything else just
    // joins with <br/>, same paragraph-spacing trick as formatAnswerHtml.
    const lines = text.split('\n').map((line) => {
        const bulletMatch = line.match(/^(\s*)-\s+(.*)$/);
        if (!bulletMatch) return line;
        return `<span style="margin-right:6px">•</span>${bulletMatch[2]}`;
    });
    let html = lines.join('<br/>').replace(/<br\/><br\/>/g, '<span style="display:block;height:0.5rem"></span>');

    html = html.replace(/__BOLD_(\d+)__/g, (m, i) => `<strong>${escapeHtml(boldParts[Number(i)] || '')}</strong>`);
    html = html.replace(/__ITAL_(\d+)__/g, (m, i) => `<em>${escapeHtml(italicParts[Number(i)] || '')}</em>`);
    html = html.replace(/__CODE_(\d+)__/g, (m, i) => `<span class="llm-code">${escapeHtml(codeParts[Number(i)] || '')}</span>`);

    html = html.replace(/@@SUMREFMARK(\d+)ENDMARK@@/g, (match, numStr) => {
        const idx = Number(numStr) - 1;
        const citation = Array.isArray(citations) ? citations[idx] : null;
        const resolvable = citation && citation.file_url;
        // Styling lives in index.css (.ref-badge / .ref-badge-disabled) —
        // needs a real :hover state, and a plain inline style string can't
        // do that. See the comment there for why no separate dark-mode rule
        // is needed despite this being a light background.
        const cls = resolvable ? 'ref-badge' : 'ref-badge-disabled';
        const action = resolvable ? ` data-app-action="view-pdf" data-ref-index="${idx}"` : '';
        return `<button type="button" class="${cls}"${action}>${numStr}</button>`;
    });

    return html;
}

// Renders one assistant message's answer body for response_format=summary:
// (@@_N) markers become clickable badges pointing at msg.citations. No
// blockquotes, no per-quote metadata line — the model isn't allowed to
// author those in this mode. The reference list itself is a separate
// ReferencePanel rendered by ChatPage at the end of the message (after
// follow-ups and the share/feedback row), not here.
export default function SummaryAnswer({ msg, displayedText, expanded, onToggleExpand, onOpenReference }) {
    const fullyDisplayed = displayedText === cleanAnswerText(msg.content);
    const collapsible = fullyDisplayed && shouldCollapseAnswer(msg.content);
    const citations = Array.isArray(msg.citations) ? msg.citations : [];

    const handleClick = (event) => {
        const target = event.target.closest('[data-app-action="view-pdf"]');
        if (!target) return;
        const idx = Number(target.getAttribute('data-ref-index'));
        const citation = citations[idx];
        if (citation) onOpenReference?.(citation);
    };

    const html = formatSummaryHtml(displayedText !== undefined ? displayedText : msg.content || '', citations);

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
