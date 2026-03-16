/**
 * usePDFJsViewer
 *
 * Shared hook for loading a PDF via PDF.js, rendering individual pages to
 * data-URLs, and extracting bookmarks (outline).
 *
 * Used by ParagraphGenEval and ParaClassifier.
 */
import { useState, useEffect, useCallback } from 'react';
import { addPageNumbersToBookmarks } from '../utils/pdfUtils';

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfJsLoadPromise = null;

function ensurePdfJsLoaded() {
    if (pdfJsLoadPromise) return pdfJsLoadPromise;

    pdfJsLoadPromise = new Promise((resolve, reject) => {
        if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
            return resolve();
        }
        const script = document.createElement('script');
        script.src = PDFJS_CDN;
        script.async = true;
        script.onload = () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
            resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });

    return pdfJsLoadPromise;
}

export function usePDFJsViewer() {
    const [pdfDoc, setPdfDoc] = useState(null);
    const [totalPages, setTotalPages] = useState(0);
    const [bookmarks, setBookmarks] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    // Ensure PDF.js is loaded once on mount
    useEffect(() => {
        ensurePdfJsLoaded().catch(err => {
            console.error('Failed to load PDF.js:', err);
        });
    }, []);

    /**
     * Load a PDF from an ArrayBuffer or a URL string.
     * Returns the loaded pdf document (or null on failure).
     */
    const loadPDF = useCallback(async (source) => {
        setIsLoading(true);
        setError(null);
        setBookmarks([]);
        try {
            await ensurePdfJsLoaded();
            const loadingTask = window.pdfjsLib.getDocument(source);
            const pdf = await loadingTask.promise;
            setPdfDoc(pdf);
            setTotalPages(pdf.numPages);

            // Extract bookmarks
            const outline = await pdf.getOutline();
            if (outline && outline.length > 0) {
                const withPages = await addPageNumbersToBookmarks(outline, pdf);
                setBookmarks(withPages);
            } else {
                setBookmarks([]);
            }

            return pdf;
        } catch (err) {
            console.error('usePDFJsViewer: error loading PDF', err);
            setError(`Failed to load PDF: ${err.message}`);
            setPdfDoc(null);
            setTotalPages(0);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * Render a 1-indexed page to a data-URL string.
     * Returns null on failure.
     */
    const renderPage = useCallback(async (pageNumber, scale = 1.5) => {
        if (!pdfDoc) return null;
        try {
            const page = await pdfDoc.getPage(pageNumber);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            return canvas.toDataURL();
        } catch (err) {
            console.error(`usePDFJsViewer: error rendering page ${pageNumber}`, err);
            return null;
        }
    }, [pdfDoc]);

    /**
     * Resolve a bookmark's destination to a 1-indexed page number.
     * Returns null if resolution fails.
     */
    const resolveBookmarkPage = useCallback(async (bookmark) => {
        if (!pdfDoc || !bookmark.dest) return null;
        try {
            let dest = bookmark.dest;
            if (typeof dest === 'string') {
                dest = await pdfDoc.getDestination(dest);
            }
            if (dest && dest[0]) {
                const pageIndex = await pdfDoc.getPageIndex(dest[0]);
                return pageIndex + 1;
            }
        } catch (err) {
            console.error('usePDFJsViewer: error resolving bookmark', err);
        }
        return null;
    }, [pdfDoc]);

    const reset = useCallback(() => {
        setPdfDoc(null);
        setTotalPages(0);
        setBookmarks([]);
        setError(null);
    }, []);

    return {
        pdfDoc,
        totalPages,
        bookmarks,
        isLoading,
        error,
        loadPDF,
        renderPage,
        resolveBookmarkPage,
        reset,
    };
}
