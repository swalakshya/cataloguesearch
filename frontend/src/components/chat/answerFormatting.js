import documentEmoji from '../../assets/emoji/document.svg';
import { CATEGORY_EMOJI_SRC } from './categoryEmoji';

// --- CITATION HELPERS (shared by the on-screen HTML renderer and the plain-text share/copy path) ---
export const parseCitationAttrs = (attrStr) => {
    const attrs = {};
    const re = /(\w+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(attrStr)) !== null) {
        attrs[m[1]] = m[2].replace(/&quot;/g, '"');
    }
    return attrs;
};

export const buildCitationLabel = (attrs) => {
    const parts = [];
    if (attrs.granth) parts.push(attrs.granth);
    if (attrs.category === 'Pravachan') {
        if (attrs.pravachankar) parts.push(`by ${attrs.pravachankar}`);
        if (attrs.series) parts.push(attrs.series);
        if (attrs.series_number) parts.push(`Series No. ${attrs.series_number}`);
        if (attrs.volume) parts.push(`Vol ${attrs.volume}`);
        if (attrs.pravachan_number) parts.push(`No. ${attrs.pravachan_number}`);
    } else {
        if (attrs.gatha) parts.push(`Gatha ${attrs.gatha}`);
        if (attrs.shlok) parts.push(`Shlok ${attrs.shlok}`);
        if (attrs.kalash) parts.push(`Kalash ${attrs.kalash}`);
        if (attrs.dohra) parts.push(`Doha ${attrs.dohra}`);
        if (attrs.kavya) parts.push(`Kavya ${attrs.kavya}`);
    }
    if (attrs.page) parts.push(`पृष्ठ ${attrs.page}`);
    if (attrs.date) parts.push(attrs.date);
    return parts.filter(Boolean).join(', ');
};

export const cleanAnswerText = (answerText) => {
    if (!answerText) return '';
    return answerText.trim();
};

export const shouldCollapseAnswer = (answerText) => {
    const cleaned = cleanAnswerText(answerText);
    const lineCount = cleaned.split('\n').filter(Boolean).length;
    return cleaned.length > 650 || lineCount > 7;
};

export const preTokenizeCitations = (answer) => {
    const blocks = [];
    const content = (answer || '').replace(/<citation([^>]*)>([\s\S]*?)<\/citation>/g, (match, attrStr, innerText) => {
        blocks.push({ attrStr, innerText });
        return `@@CITATION_${blocks.length - 1}@@`;
    });
    return { content, citationBlocks: blocks };
};

export const buildReferencePdfUrl = (fileUrl, pdfPageNumber, fallbackPageNumber) => {
    const url = String(fileUrl || '').trim();
    const page = Number(pdfPageNumber ?? fallbackPageNumber);
    if (!url) return null;
    if (!Number.isFinite(page) || page <= 0) return url;
    return url.endsWith(`/${page}`) ? url : `${url}/${page}`;
};

// [[QPDF:category:url-encoded-pdf-url]] -- an inert marker carrying a quote's
// category + PDF link through the whole tokenize/escape pipeline, resolved into a
// real badge + "View PDF" link at the very end of formatAnswerHtml. Used by both
// citation paths (the chunk-quote path in resolveChunkQuotes, and the <citation> tag
// path in formatAnswerHtml) so there's one single place that turns "category + url"
// into markup. Bracket-delimited rather than space-delimited -- a space-based version
// of this marker was silently losing its surrounding spaces somewhere in the pipeline
// (never root-caused), so this uses characters no realistic answer text or
// encodeURIComponent output can produce, no whitespace involved at all.
export const buildQuoteMetaMarker = (source) => {
    const pdfUrl = buildReferencePdfUrl(source?.file_url, source?.pdf_page_number, source?.page_number);
    if (!source?.category && !pdfUrl) return '';
    return `[[QPDF:${source?.category || ''}:${pdfUrl ? encodeURIComponent(pdfUrl) : ''}]]`;
};

// Each content category gets a distinct token-driven badge variant (not a literal
// color), so this stays correct under any of the 6 candidate palettes / dark mode.
// Used to badge inline quote citations — see the QPDF marker in formatAnswerHtml.
export const getCitationCategoryMeta = (category) => {
    switch (category) {
        case 'Pravachan':
            return { label: 'Pravachan', variant: 'info' };
        case 'Granth':
            return { label: 'Granth', variant: 'brand' };
        case 'Books':
            return { label: 'Books', variant: 'success' };
        default:
            return { label: 'Reference', variant: 'neutral' };
    }
};

export const buildInlineQuoteLabel = (citation) => {
    if (!citation) return '';
    const parts = [citation.granth];
    if (citation.category === 'Pravachan') {
        if (citation.series) parts.push(citation.series);
        if (citation.volume != null && citation.volume !== '') parts.push(`Vol ${citation.volume}`);
    } else {
        // Granth / Books: author + verse locators
        if (citation.author) parts.push(citation.author);
        const verseLocators = [
            citation.gatha   && `Gatha ${citation.gatha}`,
            citation.shlok   && `Shlok ${citation.shlok}`,
            citation.kalash  && `Kalash ${citation.kalash}`,
            // citations use "dohra", chunk_labels use "doha" — handle both
            (citation.dohra || citation.doha) && `Doha ${citation.dohra || citation.doha}`,
            citation.kavya   && `Kavya ${citation.kavya}`,
            citation.sutra   && `Sutra ${citation.sutra}`,
        ].filter(Boolean);
        parts.push(...verseLocators);
    }
    if (citation.page_number != null && citation.page_number !== '') parts.push(`पृष्ठ ${citation.page_number}`);
    return parts.filter(Boolean).join(', ');
};

// Splits a citation into a title (the work itself) and a muted secondary
// line (author/speaker, series, volume, verse locators, page, date) — used
// by the reference panel's two-line rows. Deliberately does not include
// file_url: the row itself is already the click target that opens the PDF,
// so showing the raw link as text would just be clutter.
export const buildReferenceLines = (citation) => {
    if (!citation) return { title: '', subtitle: '' };
    const title = citation.granth || citation.reference || 'Untitled reference';
    const subtitleParts = [];
    if (citation.category === 'Pravachan') {
        if (citation.pravachankar) subtitleParts.push(citation.pravachankar);
        if (citation.series) subtitleParts.push(citation.series);
        if (citation.volume != null && citation.volume !== '') subtitleParts.push(`Vol ${citation.volume}`);
        if (citation.pravachan_number) subtitleParts.push(`No. ${citation.pravachan_number}`);
    } else {
        if (citation.author) subtitleParts.push(citation.author);
        const verseLocators = [
            citation.gatha   && `Gatha ${citation.gatha}`,
            citation.shlok   && `Shlok ${citation.shlok}`,
            citation.kalash  && `Kalash ${citation.kalash}`,
            (citation.dohra || citation.doha) && `Doha ${citation.dohra || citation.doha}`,
            citation.kavya   && `Kavya ${citation.kavya}`,
            citation.sutra   && `Sutra ${citation.sutra}`,
        ].filter(Boolean);
        subtitleParts.push(...verseLocators);
    }
    if (citation.page_number != null && citation.page_number !== '') subtitleParts.push(`पृष्ठ ${citation.page_number}`);
    if (citation.date) subtitleParts.push(citation.date);
    return { title, subtitle: subtitleParts.filter(Boolean).join(', ') };
};

// Compact single-line "name — author" for the PDF viewer's header, where
// there's no room (or need) for the full subtitle the panel row shows.
export const buildReferenceTitleLine = (citation) => {
    if (!citation) return '';
    const title = citation.granth || citation.reference || 'Reference';
    const author = citation.category === 'Pravachan' ? citation.pravachankar : citation.author;
    const parts = [author, citation.volume != null && citation.volume !== '' ? `Vol ${citation.volume}` : null].filter(Boolean);
    return parts.length ? `${title} — ${parts.join(', ')}` : title;
};

// Summary mode's (@@_N) markers render as clickable badges on screen, but
// they're still literally in msg.content — copy/WhatsApp text is built
// straight from that raw string, so without this the shared text would carry
// "...है (@@_1)।" verbatim. A no-op on structured-mode text, which never
// contains this pattern, so it's safe to call unconditionally.
export const stripSummaryReferenceMarkers = (text) => {
    if (!text) return '';
    return String(text)
        .replace(/\(@@_\d+\)/g, '')
        // a removed marker often leaves "word  more" or "word ।" behind
        .replace(/[ \t]+([।.,!?])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
};

export const resolveChunkQuotes = (text, citations, chunkTexts) => {
    if (!text || !chunkTexts) return text;
    return text.replace(/^(\s*>\s*)\{\{([^}]+)\}\}\s*$/gm, (match, prefix, chunkId) => {
        const chunkData = chunkTexts[chunkId];
        if (!chunkData?.text_content) return match;
        const source = (citations || []).find(c => c.chunk_id === chunkId) || chunkData;
        const label = buildInlineQuoteLabel(source);
        const marker = buildQuoteMetaMarker(source);
        const inner = [label, marker].filter(Boolean).join('');
        return `${prefix}${chunkData.text_content}${inner ? ` (${inner})` : ''}`;
    });
};

export const formatAnswerHtml = (answerText, preloadedCitationBlocks) => {
    if (!answerText) return '';
    let sanitizedAnswer = cleanAnswerText(answerText);

    // Mark detail-prompt phrases BEFORE any tokenization so the marker survives even if the
    // phrase gets wrapped in *bold* or _italic_ by the backend.
    // @@BREAK@@ contains no chars that any tokenization regex targets.
    sanitizedAnswer = sanitizedAnswer.replace(
        /(If you want I can answer this in detail|अगर आप चाहें तो मैं और विस्तार से उत्तर दे सकता)/g,
        '@@BREAK@@$1'
    );

    const headingParts = [];
    const boldParts = [];
    const italicParts = [];
    const citationParts = [];
    const codeParts = [];
    const quoteParts = [];
    const parenParts = [];
    const citationBlocks = [];
    const actionLabelParts = [];

    // Step 0: Use pre-tokenized citation blocks if available (avoids raw <citation> tags
    // appearing mid-render during the typing animation). Otherwise extract inline.
    if (preloadedCitationBlocks && preloadedCitationBlocks.length > 0) {
        citationBlocks.push(...preloadedCitationBlocks);
    } else {
        sanitizedAnswer = sanitizedAnswer.replace(/<citation([^>]*)>([\s\S]*?)<\/citation>/g, (match, attrStr, innerText) => {
            citationBlocks.push({ attrStr, innerText });
            return `@@CITATION_${citationBlocks.length - 1}@@`;
        });
    }

    // Step 1: Extract _italic_ FIRST — before any underscore-containing tokens are created,
    // so the token strings like __CODE_0__ don't get falsely matched by _([^_\n]+?)_
    sanitizedAnswer = sanitizedAnswer.replace(/_([^_\n]+?)_/g, (match, content) => {
        italicParts.push(content);
        return `__ITAL_${italicParts.length - 1}__`;
    });

    // Step 1.5: Recognize the closed set of known interactive action placeholders.
    // Must run AFTER italic extraction (see note above) so this token's own underscores
    // don't get mistaken for _italic_ markers. This is intentionally NOT a general
    // link/markup mechanism: the action (e.g. "feedback_button") is a fixed, hardcoded
    // identifier resolved to one specific wired-up click handler below — only the visible
    // label text is free-form. LLM-generated or indexed-document text can never inject an
    // arbitrary clickable destination or URL here, only decide what a known button says.
    sanitizedAnswer = sanitizedAnswer.replace(/\[feedback_button:([^\]]+)\]/g, (match, label) => {
        actionLabelParts.push(label);
        return `__ACTION_FEEDBACK_${actionLabelParts.length - 1}__`;
    });

    // Step 2: Extract ## / ### headings
    sanitizedAnswer = sanitizedAnswer.replace(/^#{2,3}\s*(.+)$/gm, (match, content) => {
        headingParts.push(content);
        return `__HEADING_BOLD_${headingParts.length - 1}__`;
    });

    // Step 3: Extract standalone *text* lines as bold headings (single asterisk, WhatsApp style)
    sanitizedAnswer = sanitizedAnswer.replace(/^\s*\*([^*\n]+?)\*\s*$/gm, (match, content) => {
        headingParts.push(content);
        return `__HEADING_BOLD_${headingParts.length - 1}__`;
    });

    // Step 4: Strip triple backticks — render content as plain text (no code styling)
    sanitizedAnswer = sanitizedAnswer.replace(/```([^`][\s\S]*?)```/g, (match, content) => content);

    // Step 5: Extract single backtick inline code (not preceded/followed by another backtick)
    sanitizedAnswer = sanitizedAnswer.replace(/(?<!`)`([^`\n]+)`(?!`)/g, (match, content) => {
        codeParts.push(content);
        return `__CODE_${codeParts.length - 1}__`;
    });

    // Step 6: Extract > quote lines (WhatsApp-style citations); trailing (ref) stays inside the quote box
    // Leading whitespace before > is stripped so indented quote lines still match
    sanitizedAnswer = sanitizedAnswer.replace(/^\s*>\s*(.+)$/gm, (match, content) => {
        const refMatch = content.match(/^([\s\S]+?)\s*(\([^)]+\))\s*$/);
        if (refMatch) {
            quoteParts.push(refMatch[1]);
            citationParts.push(refMatch[2]);
            return `__QUOTCITE_${quoteParts.length - 1}_${citationParts.length - 1}__`;
        }
        quoteParts.push(content);
        return `__QUOT_${quoteParts.length - 1}__`;
    });

    // Step 7: Extract inline *bold* (single asterisk, WhatsApp style)
    let text = sanitizedAnswer.replace(/\*([^*\n]+?)\*/g, (match, content) => {
        boldParts.push(content);
        return `__BOLD_${boldParts.length - 1}__`;
    });

    // Step 8: Extract curly-quoted text as italic
    text = text.replace(/”([^”]+)”/g, (match, content) => {
        italicParts.push(content);
        return `__ITAL_${italicParts.length - 1}__`;
    });
    text = text.replace(/”([^”]+)”/g, (match, content) => {
        italicParts.push(content);
        return `__ITAL_${italicParts.length - 1}__`;
    });

    // Step 9: Extract parenthesised text for smaller rendering.
    // Runs after all other tokenizations so (ref) from citations is already gone (__QUOTCITE__ token).
    // __PAREN__ is placed first in the replacement chain so any inner tokens still get resolved.
    text = text.replace(/\(([^)\n]+)\)/g, (match, content) => {
        parenParts.push(content);
        return `__PAREN_${parenParts.length - 1}__`;
    });

    const escapeHtml = (value) =>
        value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

    text = escapeHtml(text);

    // Collapse runs of 3+ newlines down to one blank line (reduces excessive gaps from
    // verbose LLM output) while preserving a single intentional blank-line paragraph break.
    text = text.replace(/\n{3,}/g, '\n\n');

    // Split into lines; insert spacing before headings and citation blocks
    const lines = text.split('\n');
    const segments = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (segments.length > 0) {
            const lastSegment = segments[segments.length - 1];
            // Blank line before headings (skip if one is already there from the source text)
            if (/^__HEADING_BOLD_\d+__$/.test(trimmed) && lastSegment !== '') {
                segments.push('');
            }
            // Small-gap line before citation blocks (grey quote lines)
            if (/^__QUOT(?:CITE)?_\d+/.test(trimmed) && lastSegment !== '') {
                segments.push('<span style="display:block;height:0"></span>');
            }
        }
        segments.push(line);
    }

    let html = segments.join('<br/>');

    // A blank line in the source (paragraph break) becomes an empty segment between
    // two <br/>s, i.e. a full blank TEXT LINE (~1 line-height, ~26px) — much taller
    // than intended just to separate paragraphs. Replace that specific pattern with a
    // smaller fixed-height spacer instead of a whole empty line of text.
    html = html.replace(/<br\/><br\/>/g, '<span style="display:block;height:0.5rem"></span>');

    // __PAREN__ first so any inner tokens (__BOLD__, __ITAL__, etc.) are resolved by subsequent steps
    html = html.replace(/__PAREN_(\d+)__/g, (match, idx) => {
        const content = parenParts[Number(idx)] || '';
        return `<span style="font-size:0.82em">(${escapeHtml(content)})</span>`;
    });

    html = html.replace(/__HEADING_BOLD_(\d+)__/g, (match, idx) => {
        const content = headingParts[Number(idx)] || '';
        return `<strong>${escapeHtml(content)}</strong><hr class="llm-bold-separator"/>`;
    });
    html = html.replace(/__BOLD_(\d+)__/g, (match, idx) => {
        const content = boldParts[Number(idx)] || '';
        return `<strong>${escapeHtml(content)}</strong>`;
    });
    html = html.replace(/__ITAL_(\d+)__/g, (match, idx) => {
        const content = italicParts[Number(idx)] || '';
        return `<em>${escapeHtml(content)}</em>`;
    });
    html = html.replace(/__QUOTCITE_(\d+)_(\d+)__/g, (match, quoteIdx, citeIdx) => {
        const content = quoteParts[Number(quoteIdx)] || '';
        const citation = citationParts[Number(citeIdx)] || '';
        return `<span class="llm-quote-block">${escapeHtml(content)}<span class="llm-quote-citation">${escapeHtml(citation)}</span></span>`;
    });
    html = html.replace(/__QUOT_(\d+)__/g, (match, idx) => {
        const content = quoteParts[Number(idx)] || '';
        return `<span class="llm-quote-block">${escapeHtml(content)}</span>`;
    });

    html = html.replace(/@@CITATION_(\d+)@@/g, (match, idx) => {
        const block = citationBlocks[Number(idx)];
        if (!block) return '';
        const attrs = parseCitationAttrs(block.attrStr);
        const escapedText = escapeHtml(block.innerText.trim()).replace(/\r?\n/g, '<br/>');
        const label = buildCitationLabel(attrs);
        const marker = buildQuoteMetaMarker({ category: attrs.category, file_url: attrs.file_url, pdf_page_number: attrs.pdf_page_number, page_number: attrs.page });
        const inner = `${escapeHtml(label)}${marker}`;
        const labelHtml = (label || marker) ? `<span class="llm-quote-citation">${inner}</span>` : '';
        return `<span class="llm-quote-block">${escapedText}${labelHtml}</span>`;
    });
    html = html.replace(/__CITE_(\d+)__/g, (match, idx) => {
        const content = citationParts[Number(idx)] || '';
        const escaped = escapeHtml(content);
        return `<div style="display:block;text-align:right;margin-top:0.1rem"><sub style="font-size:0.65em;color:var(--color-ink-muted);font-style:italic">${escaped}</sub></div>`;
    });
    html = html.replace(/__CODE_(\d+)__/g, (match, idx) => {
        const content = codeParts[Number(idx)] || '';
        return `<span class="llm-code">${escapeHtml(content)}</span>`;
    });
    html = html.replace(/__ACTION_FEEDBACK_(\d+)__/g, (match, idx) => {
        const label = actionLabelParts[Number(idx)] || 'Feedback';
        return `<button type="button" data-app-action="feedback" class="text-brand underline decoration-brand underline-offset-2 hover:text-brand-hover transition-colors">${escapeHtml(label)}</button>`;
    });

    // Change #1: citation divs are display:block so they create their own line break;
    // remove the extra <br/> the segment join places immediately after </div> to avoid double-spacing.
    html = html.replace(/<\/div><br\/>/g, '</div>');

    // Resolve detail-prompt break markers inserted before tokenization
    html = html.replace(/@@BREAK@@/g, '<br/>');

    // Resolve QPDF markers (see buildQuoteMetaMarker) into "| <emoji> Category: X | <emoji> View PDF",
    // now that escaping is done — the one place both citation paths (embedded
    // <citation> tags, and {{chunk_id}} quotes) end up rendered.
    html = html.replace(/\[\[QPDF:([^:\]]*):([^\]]*)\]\]/g, (match, category, encodedUrl) => {
        const parts = [];
        if (category) {
            const meta = getCitationCategoryMeta(category);
            const emojiSrc = CATEGORY_EMOJI_SRC[category];
            const emojiHtml = emojiSrc ? `<img src="${emojiSrc}" alt="" class="llm-inline-emoji" />` : '';
            parts.push(`<span class="llm-quote-meta-item">${emojiHtml}Category: ${escapeHtml(meta.label)}</span>`);
        }
        if (encodedUrl) {
            const pdfUrl = decodeURIComponent(encodedUrl);
            // A button, not an <a href target="_blank"> — StructuredAnswer's delegated
            // click handler reads data-app-action/data-pdf-url to open the shared
            // PdfCitationModal instead of navigating away. See PdfCitationModal's
            // resolveCitationTarget for how the page-suffixed URL gets parsed back apart.
            parts.push(`<button type="button" data-app-action="view-pdf" data-pdf-url="${escapeHtml(pdfUrl)}" data-category="${escapeHtml(category || '')}" class="llm-quote-meta-item llm-view-pdf-link"><img src="${documentEmoji}" alt="" class="llm-inline-emoji" />View PDF</button>`);
        }
        return parts.length ? ` | ${parts.join(' | ')}` : '';
    });

    return html;
};
