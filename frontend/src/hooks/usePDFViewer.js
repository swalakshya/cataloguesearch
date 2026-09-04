import { useState, useEffect, useRef } from 'react';
import { addPageNumbersToBookmarks } from '../utils/pdfUtils';

/**
 * Shared hook for PDF viewing, page navigation, and cropped preview.
 * Used by OCRUtils and ScriptureLLMEval.
 */
const usePDFViewer = ({ setError }) => {
    const [pdfDoc, setPdfDoc] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [croppedPreviewUrl, setCroppedPreviewUrl] = useState(null);
    const [bookmarks, setBookmarks] = useState([]);
    // url -> already-parsed pdf.js document, scoped to this hook instance's
    // lifetime. loadPDFFromUrl checks this before hitting the network again —
    // re-opening a citation you already viewed this session (or a different
    // citation pointing at the same source document) then skips straight to
    // rendering instead of re-fetching/re-parsing.
    const urlDocCacheRef = useRef(new Map());

    // Load PDF.js once per page
    useEffect(() => {
        if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.async = true;
        script.onload = () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        };
        script.onerror = () => setError('Failed to load PDF.js library.');
        document.head.appendChild(script);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const renderPDFPage = async (pdf, pageNum) => {
        try {
            const page = await pdf.getPage(pageNum);
            const scale = 1.5;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            const dataUrl = canvas.toDataURL('image/png');
            setPreviewUrl(dataUrl);
            return dataUrl;
        } catch (err) {
            setError(`Error rendering PDF page: ${err.message}`);
            return null;
        }
    };

    const applyCropToDataUrl = (dataUrl, cropTopPct, cropBottomPct, cropLeftPct = 0, cropRightPct = 0) => {
        if (!dataUrl || (cropTopPct === 0 && cropBottomPct === 0 && cropLeftPct === 0 && cropRightPct === 0)) {
            setCroppedPreviewUrl(null);
            return;
        }
        const img = new Image();
        img.onload = () => {
            const { width, height } = img;
            const topPx = Math.floor(height * cropTopPct / 100);
            const bottomPx = Math.floor(height * cropBottomPct / 100);
            const leftPx = Math.floor(width * cropLeftPct / 100);
            const rightPx = Math.floor(width * cropRightPct / 100);
            const croppedWidth = width - leftPx - rightPx;
            const croppedHeight = height - topPx - bottomPx;
            const canvas = document.createElement('canvas');
            canvas.width = croppedWidth;
            canvas.height = croppedHeight;
            canvas.getContext('2d').drawImage(img, leftPx, topPx, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
            setCroppedPreviewUrl(canvas.toDataURL('image/png'));
        };
        img.src = dataUrl;
    };

    const loadPDF = async (file) => {
        if (!window.pdfjsLib) {
            setError('PDF.js library not loaded. Please refresh the page.');
            return;
        }
        setCroppedPreviewUrl(null);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument(arrayBuffer).promise;
            setPdfDoc(pdf);
            setTotalPages(pdf.numPages);
            setCurrentPage(1);
            try {
                const outline = await pdf.getOutline();
                setBookmarks(outline?.length > 0 ? await addPageNumbersToBookmarks(outline, pdf) : []);
            } catch {
                setBookmarks([]);
            }
            await renderPDFPage(pdf, 1);
        } catch (err) {
            setError(`Error loading PDF: ${err.message}`);
        }
    };

    // Citation-viewer counterpart to loadPDF(file) — loads directly from a
    // remote URL (a citation's file_url) instead of a local File object, and
    // jumps straight to startPage instead of always landing on page 1. Relies
    // on the PDF host allowing cross-origin fetch/range-requests; if it
    // doesn't, pdf.js's getDocument() rejects and the catch below surfaces
    // that as the same user-visible error loadPDF already handles.
    //
    // onProgress, if given, receives pdf.js's own {loaded, total} network
    // progress as bytes come in — total is only known if the server sent
    // Content-Length (see backend/api/pdf_proxy.py), otherwise it's null and
    // the caller should fall back to an indeterminate loading state.
    const loadPDFFromUrl = async (url, startPage = 1, onProgress) => {
        if (!window.pdfjsLib) {
            setError('PDF.js library not loaded. Please refresh the page.');
            return null;
        }
        setCroppedPreviewUrl(null);
        try {
            let pdf = urlDocCacheRef.current.get(url);
            if (!pdf) {
                const loadingTask = window.pdfjsLib.getDocument(url);
                if (onProgress) {
                    loadingTask.onProgress = ({ loaded, total }) => {
                        onProgress({ loaded, total: total || null });
                    };
                }
                pdf = await loadingTask.promise;
                urlDocCacheRef.current.set(url, pdf);
            }
            setPdfDoc(pdf);
            setTotalPages(pdf.numPages);
            const page = Number.isFinite(startPage) && startPage >= 1 && startPage <= pdf.numPages ? startPage : 1;
            setCurrentPage(page);
            try {
                const outline = await pdf.getOutline();
                setBookmarks(outline?.length > 0 ? await addPageNumbersToBookmarks(outline, pdf) : []);
            } catch {
                setBookmarks([]);
            }
            await renderPDFPage(pdf, page);
            return pdf;
        } catch (err) {
            setError(`Error loading PDF: ${err.message}`);
            return null;
        }
    };

    const loadImagePreview = (file) => {
        setPreviewUrl(URL.createObjectURL(file));
        setCroppedPreviewUrl(null);
        setPdfDoc(null);
        setTotalPages(1);
        setCurrentPage(1);
        setBookmarks([]);
    };

    const handlePageNavigation = async (direction, cropTop, cropBottom, onPageChanged, cropLeft = 0, cropRight = 0) => {
        if (!pdfDoc) return;
        let newPage = currentPage;
        if (direction === 'prev' && currentPage > 1) newPage = currentPage - 1;
        else if (direction === 'next' && currentPage < totalPages) newPage = currentPage + 1;
        if (newPage !== currentPage) {
            setCurrentPage(newPage);
            const dataUrl = await renderPDFPage(pdfDoc, newPage);
            applyCropToDataUrl(dataUrl, cropTop, cropBottom, cropLeft, cropRight);
            if (onPageChanged) onPageChanged();
        }
    };

    const jumpToPage = async (page, cropTop, cropBottom, onPageChanged, cropLeft = 0, cropRight = 0) => {
        const p = parseInt(page, 10);
        if (!pdfDoc || isNaN(p) || p < 1 || p > totalPages || p === currentPage) return;
        setCurrentPage(p);
        const dataUrl = await renderPDFPage(pdfDoc, p);
        applyCropToDataUrl(dataUrl, cropTop, cropBottom, cropLeft, cropRight);
        if (onPageChanged) onPageChanged();
    };

    const navigateToBookmark = async (bookmark, onPageChanged) => {
        if (!pdfDoc || !bookmark.dest) return;
        try {
            let dest = bookmark.dest;
            if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
            if (dest?.length > 0) {
                const pageNumber = await pdfDoc.getPageIndex(dest[0]) + 1;
                if (pageNumber !== currentPage) {
                    setCurrentPage(pageNumber);
                    await renderPDFPage(pdfDoc, pageNumber);
                    setCroppedPreviewUrl(null);
                    if (onPageChanged) onPageChanged();
                }
            }
        } catch (err) {
            console.error('Error navigating to bookmark:', err);
        }
    };

    return {
        pdfDoc, currentPage, totalPages, previewUrl, croppedPreviewUrl, bookmarks,
        setCroppedPreviewUrl, setPreviewUrl,
        loadPDF, loadPDFFromUrl, loadImagePreview, renderPDFPage, applyCropToDataUrl,
        handlePageNavigation, jumpToPage, navigateToBookmark,
    };
};

export default usePDFViewer;
