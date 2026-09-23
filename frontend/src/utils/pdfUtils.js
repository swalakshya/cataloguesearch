/**
 * Helper function to recursively add page numbers to PDF bookmarks
 * @param {Array} bookmarkItems - Array of bookmark objects from PDF outline
 * @param {Object} pdfDoc - PDF.js document object
 * @returns {Array} - Array of bookmark objects with pageNumber property added
 */
export const addPageNumbersToBookmarks = async (bookmarkItems, pdfDoc) => {
    const processedItems = [];

    for (const item of bookmarkItems) {
        const processedItem = { ...item };

        // Calculate page number for this bookmark
        try {
            if (item.dest) {
                let dest = item.dest;

                // If dest is a string, get the actual destination
                if (typeof dest === 'string') {
                    dest = await pdfDoc.getDestination(dest);
                }

                if (dest && dest[0]) {
                    const pageRef = dest[0];
                    const pageIndex = await pdfDoc.getPageIndex(pageRef);
                    processedItem.pageNumber = pageIndex + 1; // PDF pages are 1-indexed
                }
            }
        } catch (err) {
            console.error(`Error calculating page number for "${item.title}":`, err);
        }

        // Recursively process nested items
        if (item.items && item.items.length > 0) {
            processedItem.items = await addPageNumbersToBookmarks(item.items, pdfDoc);
        }

        processedItems.push(processedItem);
    }

    return processedItems;
};
// Resolves a citation's (file_url, page) pair. Summary-mode citations carry
// page_number/pdf_page_number as separate fields alongside a clean file_url.
// Structured mode reconstructs a citation from the QPDF marker embedded in
// formatAnswerHtml's output, which only has a page-suffixed URL (see
// buildReferencePdfUrl in answerFormatting.js) — no separate page field — so
// that suffix has to be parsed back off before handing the URL to pdf.js.
export function resolveCitationTarget(citation) {
    const rawUrl = String(citation?.file_url || '').trim();
    const explicitPage = Number(citation?.pdf_page_number ?? citation?.page_number);
    if (Number.isFinite(explicitPage) && explicitPage > 0) {
        return { url: rawUrl, page: explicitPage };
    }
    const suffixMatch = rawUrl.match(/^(.*)\/(\d+)$/);
    if (suffixMatch) {
        return { url: suffixMatch[1], page: Number(suffixMatch[2]) };
    }
    return { url: rawUrl, page: 1 };
}

// Link that opens the citation's PDF in the browser's own viewer at its page.
// Works for both raw source URLs (Khoj results) and /url/{code} short links
// (Chat) — a 302 without its own fragment keeps ours. Mobile viewers often
// ignore #page, which is why callers also show the page number as text.
export function buildPdfPageUrl(citation) {
    const { url, page } = resolveCitationTarget(citation);
    if (!url) return null;
    return `${url.split('#')[0]}#page=${page}`;
}
