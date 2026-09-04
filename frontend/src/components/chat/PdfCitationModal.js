import React, { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Minus, Plus, Link2, Download, Check } from 'lucide-react';
import { useOverlayBehavior } from '../ui/Modal';
import usePDFViewer from '../../hooks/usePDFViewer';
import { api } from '../../services/api';
import { Spinner } from '../SharedComponents';
import { buildReferenceTitleLine } from './answerFormatting';
import { copyToClipboard } from '../../utils/shareUtils';

// Starting zoom is 1 (100%, the page's natural fit-to-container size); MIN
// sits below that so the "−" button isn't permanently disabled at rest.
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

// Resolves a citation's (file_url, page) pair. Summary-mode citations carry
// page_number/pdf_page_number as separate fields alongside a clean file_url.
// Structured mode reconstructs a citation from the QPDF marker embedded in
// formatAnswerHtml's output, which only has a page-suffixed URL (see
// buildReferencePdfUrl in answerFormatting.js) — no separate page field — so
// that suffix has to be parsed back off before handing the URL to pdf.js.
function resolveCitationTarget(citation) {
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

// Shared PDF popup for both structured and summary chat modes — resizable
// card over a dimmed backdrop on desktop, full-screen takeover on mobile (no
// backdrop dimming needed there since the card already fills the viewport).
// One instance lives in ChatPage; both StructuredAnswer's "View PDF" click
// and SummaryAnswer's reference badges/panel open it via the same
// onOpenReference(citation) callback.
export default function PdfCitationModal({ citation, onClose }) {
    const open = Boolean(citation);
    const [error, setError] = useState(null);
    const [jumpValue, setJumpValue] = useState('');
    const [zoom, setZoom] = useState(1);
    const [linkCopied, setLinkCopied] = useState(false);
    const [downloading, setDownloading] = useState(false);
    // {loaded, total} from pdf.js's own network progress, total is null until
    // the proxy's Content-Length is known (see usePDFViewer's loadPDFFromUrl).
    const [loadProgress, setLoadProgress] = useState(null);
    const {
        currentPage, totalPages, previewUrl,
        loadPDFFromUrl, handlePageNavigation, jumpToPage, setPreviewUrl,
    } = usePDFViewer({ setError });

    useOverlayBehavior(open, onClose);

    useEffect(() => {
        if (!citation) return;
        let cancelled = false;
        setError(null);
        setZoom(1);
        // Clear the previous citation's rendered page immediately — without
        // this, previewUrl stays populated with the OLD page while the new
        // one loads, so clicking a different reference looked like it did
        // nothing (same page stayed on screen) until the new render replaced
        // it. loadPDFFromUrl's own document cache means this is a near-instant
        // blank-then-redraw for a citation already viewed this session, and a
        // real loading state for a genuinely new one.
        setPreviewUrl(null);
        const { url, page } = resolveCitationTarget(citation);
        if (!url) {
            setError('This reference has no source PDF linked.');
            return;
        }
        setLoadProgress({ loaded: 0, total: null });
        // Routed through the backend proxy — the source hosts (and our own
        // /url/{code} shortener that 302s to them) don't send CORS headers,
        // so pdf.js can't fetch them directly from the browser. See
        // services/api.js's buildPdfProxyUrl and backend/api/pdf_proxy.py.
        (async () => {
            await loadPDFFromUrl(api.buildPdfProxyUrl(url), page, (progress) => {
                if (!cancelled) setLoadProgress(progress);
            });
            if (!cancelled) setLoadProgress(null);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [citation]);

    useEffect(() => {
        setJumpValue(currentPage ? String(currentPage) : '');
    }, [currentPage]);

    if (!open) return null;

    const title = buildReferenceTitleLine(citation) || 'Reference';
    const progressPct = loadProgress?.total
        ? Math.min(100, Math.round((loadProgress.loaded / loadProgress.total) * 100))
        : null;

    const submitJump = () => {
        const page = parseInt(jumpValue, 10);
        if (Number.isFinite(page)) jumpToPage(page, 0, 0);
    };

    const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
    const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));

    const handleCopyLink = async () => {
        if (!citation?.file_url) return;
        const success = await copyToClipboard(citation.file_url);
        if (success) {
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
        }
    };

    // Fetches through our own proxy rather than linking straight to the
    // source host — a bare cross-origin <a href download> mostly just opens
    // the file in a new tab instead of downloading it, since browsers only
    // honor `download` reliably for same-origin (or CORS-visible) responses.
    // See backend/api/pdf_proxy.py, the same reason this whole proxy exists.
    const handleDownload = async () => {
        const { url } = resolveCitationTarget(citation);
        if (!url) return;
        setDownloading(true);
        try {
            const response = await fetch(api.buildPdfProxyUrl(url));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = `${(citation?.granth || 'reference').replace(/[^\w-]+/g, '_')}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(blobUrl);
        } catch {
            setError('Could not download the PDF.');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={onClose}
        >
            <div
                className="w-full h-full md:w-[90vw] md:h-[90vh] md:max-w-[1200px] flex flex-col rounded-none md:rounded-xl border-0 md:border"
                style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    resize: 'both',
                    overflow: 'hidden',
                    minWidth: '20rem',
                    minHeight: '16rem',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-1 px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-ink mr-2" title={title}>{title}</span>
                    <button
                        onClick={handleCopyLink}
                        disabled={!citation?.file_url}
                        className="shrink-0 h-7 w-7 rounded flex items-center justify-center disabled:opacity-30"
                        style={{ color: linkCopied ? 'var(--color-success)' : 'var(--color-info)' }}
                        aria-label="Copy link"
                        title="Copy link"
                    >
                        {linkCopied ? <Check size={16} /> : <Link2 size={16} />}
                    </button>
                    <button
                        onClick={handleDownload}
                        disabled={!citation?.file_url || downloading}
                        className="shrink-0 h-7 w-7 rounded flex items-center justify-center disabled:opacity-30"
                        style={{ color: 'var(--color-brand)' }}
                        aria-label="Download PDF"
                        title="Download PDF"
                    >
                        {downloading ? <Spinner /> : <Download size={16} />}
                    </button>
                    <button onClick={onClose} className="text-ink-muted hover:text-ink shrink-0 h-7 w-7 rounded flex items-center justify-center" aria-label="Close">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 relative flex items-center justify-center overflow-auto p-4" style={{ backgroundColor: 'var(--color-bg)' }}>
                    {error && (
                        <p className="text-sm text-center px-6" style={{ color: 'var(--color-danger)' }}>{error}</p>
                    )}
                    {!error && previewUrl && (
                        <img
                            src={previewUrl}
                            alt={`Page ${currentPage}`}
                            className="max-w-full max-h-full object-contain shadow-sm"
                            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
                        />
                    )}
                    {!error && !previewUrl && (
                        <div className="flex flex-col items-center gap-2 text-sm text-ink-muted">
                            <Spinner />
                            <span>{progressPct != null ? `${progressPct}%` : 'Loading…'}</span>
                        </div>
                    )}
                    {!error && previewUrl && totalPages > 1 && (
                        <>
                            <button
                                onClick={() => handlePageNavigation('prev', 0, 0)}
                                disabled={currentPage <= 1}
                                className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full flex items-center justify-center disabled:opacity-30"
                                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                                aria-label="Previous page"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <button
                                onClick={() => handlePageNavigation('next', 0, 0)}
                                disabled={currentPage >= totalPages}
                                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full flex items-center justify-center disabled:opacity-30"
                                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                                aria-label="Next page"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </>
                    )}
                </div>

                {!error && previewUrl && (
                    <div className="flex items-center gap-2 px-4 py-2 border-t text-xs text-ink-muted shrink-0" style={{ borderColor: 'var(--color-border)' }}>
                        {totalPages > 1 && (
                            <>
                                <span>Jump to</span>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={jumpValue}
                                    onChange={(e) => setJumpValue(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && submitJump()}
                                    onBlur={submitJump}
                                    className="w-12 text-center rounded"
                                    style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-ink)' }}
                                />
                                <span>/ {totalPages}</span>
                            </>
                        )}
                        <div className="ml-auto flex items-center gap-1">
                            <button
                                onClick={zoomOut}
                                disabled={zoom <= ZOOM_MIN}
                                className="h-6 w-6 rounded flex items-center justify-center disabled:opacity-30"
                                style={{ border: '1px solid var(--color-border)' }}
                                aria-label="Zoom out"
                            >
                                <Minus size={12} />
                            </button>
                            <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
                            <button
                                onClick={zoomIn}
                                disabled={zoom >= ZOOM_MAX}
                                className="h-6 w-6 rounded flex items-center justify-center disabled:opacity-30"
                                style={{ border: '1px solid var(--color-border)' }}
                                aria-label="Zoom in"
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
