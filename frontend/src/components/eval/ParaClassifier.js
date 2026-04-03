/**
 * ParaClassifier
 *
 * Eval tab for manually fixing Gemini OCR classification errors.
 *
 * Left  — PDF page image served by the backend (pre-cropped for multi-page PDFs)
 * Right — Blocks from page_XXXX.json with an inline type selector per block
 *
 * Zero PDF.js — all logic (page mapping, image rendering, bookmarks) is on the backend.
 */
import React, { useState, useEffect, useCallback } from 'react';
import BookmarksModal from '../BookmarksModal';
import ShowBookmarksButton from '../ShowBookmarksButton';
import { Spinner } from '../SharedComponents';
import useArrowNavigation from '../../hooks/useArrowNavigation';

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

// Coloured pill styles per type
const TYPE_COLOURS = {
    hindi_text:      'bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200',
    sanskrit_text:   'bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-200',
    prakrit_text:    'bg-indigo-100 text-indigo-800 border-indigo-300 hover:bg-indigo-200',
    hindi_verse:     'bg-green-100 text-green-800 border-green-300 hover:bg-green-200',
    sanskrit_verse:  'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200',
    prakrit_verse:   'bg-teal-100 text-teal-800 border-teal-300 hover:bg-teal-200',
    footnote:        'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200',
    chapter_heading: 'bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-200',
};

// Two-letter abbreviations shown for non-selected types
const TYPE_ABBR = {
    hindi_text:      'HT',
    sanskrit_text:   'ST',
    prakrit_text:    'PT',
    hindi_verse:     'HV',
    sanskrit_verse:  'SV',
    prakrit_verse:   'PV',
    footnote:        'FN',
    chapter_heading: 'CH',
};

// ─── tiny helpers ─────────────────────────────────────────────────────────────

const enc = (s) => encodeURIComponent(s);

async function apiFetch(url) {
    const r = await fetch(url);
    if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${r.status}`);
    }
    return r.json();
}

// ─── component ────────────────────────────────────────────────────────────────

const ParaClassifier = ({ selectedFile }) => {
    const ocrPath = selectedFile?.relativePath ?? null;

    // ── meta (fetched once per file) ─────────────────────────────────────────
    const [blockTypes,     setBlockTypes]     = useState([]);
    const [availablePages, setAvailablePages] = useState([]);
    const [bookmarks,      setBookmarks]      = useState([]);
    const [metaError,      setMetaError]      = useState(null);
    const [metaLoading,    setMetaLoading]    = useState(false);

    // ── per-page state ───────────────────────────────────────────────────────
    const [pageIndex,     setPageIndex]     = useState(0);
    const [jumpInput,     setJumpInput]     = useState('');
    const [pdfDataUrl,    setPdfDataUrl]    = useState(null);
    const [imageLoading,  setImageLoading]  = useState(false);
    const [blocks,        setBlocks]        = useState([]);      // current (possibly edited) types
    const [originalTypes, setOriginalTypes] = useState([]);      // types as loaded from disk
    const [blocksLoading, setBlocksLoading] = useState(false);
    const [blocksError,   setBlocksError]   = useState(null);

    // ── UI ───────────────────────────────────────────────────────────────────
    const [showBookmarksModal, setShowBookmarksModal] = useState(false);
    const [saveStatus,         setSaveStatus]         = useState(null);

    const currentLogicalPage = availablePages[pageIndex] ?? null;

    // OCR dir path for display (relative path stripped of leading components)
    const pageFilePath = ocrPath && currentLogicalPage !== null
        ? `${ocrPath}/page_${String(currentLogicalPage).padStart(4, '0')}.json`
        : null;

    // ── Load block-types once ─────────────────────────────────────────────────
    useEffect(() => {
        apiFetch(`${API_BASE_URL}/eval/classifier/block-types`)
            .then(d => setBlockTypes(d.block_types || []))
            .catch(err => console.error('Failed to load block types', err));
    }, []);

    // ── Load page-mapping + bookmarks when file changes ───────────────────────
    useEffect(() => {
        if (!ocrPath) return;

        setMetaLoading(true);
        setMetaError(null);
        setAvailablePages([]);
        setBookmarks([]);
        setPageIndex(0);
        setPdfDataUrl(null);
        setBlocks([]);
        setOriginalTypes([]);

        Promise.all([
            apiFetch(`${API_BASE_URL}/eval/pdf/page-mapping?ocr_relative_path=${enc(ocrPath)}`),
            apiFetch(`${API_BASE_URL}/eval/pdf/bookmarks?ocr_relative_path=${enc(ocrPath)}`),
        ])
            .then(([mapping, bkmks]) => {
                const pages = mapping.available_pages || [];
                setAvailablePages(pages);
                const adapted = (bkmks.bookmarks || []).map(b => ({
                    ...b,
                    dest: true,
                    pageNumber: b.logical_page,
                    items: [],
                }));
                setBookmarks(adapted);
                if (pages.length > 0) setJumpInput(String(pages[0]));
            })
            .catch(err => setMetaError(err.message))
            .finally(() => setMetaLoading(false));
    }, [ocrPath]);

    // ── Fetch page image when logical page changes ────────────────────────────
    useEffect(() => {
        if (!ocrPath || currentLogicalPage === null) return;

        setImageLoading(true);
        setPdfDataUrl(null);

        apiFetch(
            `${API_BASE_URL}/eval/pdf/page-image` +
            `?ocr_relative_path=${enc(ocrPath)}&logical_page=${currentLogicalPage}`
        )
            .then(d => setPdfDataUrl(`data:image/png;base64,${d.image}`))
            .catch(err => console.error('Image fetch error:', err))
            .finally(() => setImageLoading(false));
    }, [ocrPath, currentLogicalPage]);

    // ── Fetch blocks when logical page changes ────────────────────────────────
    useEffect(() => {
        if (!ocrPath || currentLogicalPage === null) return;

        setBlocksLoading(true);
        setBlocksError(null);
        setSaveStatus(null);
        setBlocks([]);
        setOriginalTypes([]);

        apiFetch(
            `${API_BASE_URL}/eval/classifier/page` +
            `?ocr_relative_path=${enc(ocrPath)}&page=${currentLogicalPage}`
        )
            .then(d => {
                const loaded = d.blocks || [];
                setBlocks(loaded);
                setOriginalTypes(loaded.map(b => b.type));
            })
            .catch(err => setBlocksError(err.message))
            .finally(() => setBlocksLoading(false));
    }, [ocrPath, currentLogicalPage]);

    // ── Navigation ────────────────────────────────────────────────────────────
    const goToIndex = useCallback((idx) => {
        const clamped = Math.max(0, Math.min(idx, availablePages.length - 1));
        setPageIndex(clamped);
        setJumpInput(String(availablePages[clamped] ?? ''));
    }, [availablePages]);

    useArrowNavigation(
        useCallback(() => goToIndex(pageIndex - 1), [goToIndex, pageIndex]),
        useCallback(() => goToIndex(pageIndex + 1), [goToIndex, pageIndex]),
        availablePages.length > 0,
    );

    const handleJump = () => {
        const target = parseInt(jumpInput, 10);
        if (isNaN(target)) return;
        const idx = availablePages.findIndex(p => p >= target);
        goToIndex(idx === -1 ? availablePages.length - 1 : idx);
    };

    const handleBookmarkClick = (bookmark) => {
        const idx = availablePages.findIndex(p => p >= bookmark.logical_page);
        goToIndex(idx === -1 ? availablePages.length - 1 : idx);
        setShowBookmarksModal(false);
    };

    // ── Classification ────────────────────────────────────────────────────────
    const reclassify = (blockIndex, newType) => {
        setBlocks(prev => prev.map((b, i) =>
            i === blockIndex ? { ...b, type: newType } : b
        ));
    };

    // ── Save ──────────────────────────────────────────────────────────────────
    const handleSave = async () => {
        if (!window.confirm(
            `Save corrections for page ${currentLogicalPage}?\n\n` +
            `A backup (page_${String(currentLogicalPage).padStart(4, '0')}.json.bak) ` +
            `will be created on the first save of this page.`
        )) return;

        setSaveStatus(null);
        try {
            const resp = await fetch(`${API_BASE_URL}/eval/classifier/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ocr_relative_path: ocrPath,
                    page: currentLogicalPage,
                    blocks,
                }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
            // After successful save, update originalTypes so edited indicators reset
            setOriginalTypes(blocks.map(b => b.type));
            setSaveStatus({ ok: true, message: data.message });
        } catch (err) {
            setSaveStatus({ ok: false, message: err.message });
        }
    };

    // ── Empty state ───────────────────────────────────────────────────────────
    if (!selectedFile) {
        return (
            <div className="rounded-lg shadow-sm border border-slate-200 p-12 text-center" style={{ backgroundColor: 'var(--bg-card)' }}>
                <svg className="mx-auto h-16 w-16 text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="text-lg font-semibold text-slate-700 mb-2">No PDF selected</h3>
                <p className="text-slate-500 text-sm">Use "Browse Files" above to select a PDF.</p>
            </div>
        );
    }

    // ── Main layout ───────────────────────────────────────────────────────────
    const totalLogical = availablePages.length;
    const editedCount = blocks.filter((b, i) => b.type !== originalTypes[i]).length;

    return (
        <div className="rounded-lg shadow-sm border border-slate-200" style={{ backgroundColor: 'var(--bg-card)' }}>
            {/* Header */}
            <div className="p-4 border-b border-slate-200">
                <h2 className="text-2xl font-bold text-slate-800 mb-1">Paragraph Classifier</h2>
                <p className="text-slate-500 text-sm font-mono">{ocrPath}</p>
            </div>

            {/* Meta loading / error */}
            {metaLoading && (
                <div className="flex items-center gap-2 p-4">
                    <Spinner /><span className="text-slate-500 text-sm">Loading file info…</span>
                </div>
            )}
            {metaError && (
                <div className="mx-4 mt-3 px-4 py-2 rounded text-sm bg-red-50 border border-red-200 text-red-800">
                    {metaError}
                </div>
            )}

            {/* Controls bar */}
            {!metaLoading && !metaError && totalLogical > 0 && (
                <div className="p-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
                    {/* Page navigation */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => goToIndex(pageIndex - 1)}
                            disabled={pageIndex <= 0}
                            className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded disabled:opacity-40 hover:bg-slate-300 transition-colors text-sm"
                        >
                            ← Prev
                        </button>

                        <span className="text-sm text-slate-600 whitespace-nowrap">
                            Page <span className="font-semibold">{currentLogicalPage}</span>
                            {' '}({pageIndex + 1} / {totalLogical})
                        </span>

                        <button
                            onClick={() => goToIndex(pageIndex + 1)}
                            disabled={pageIndex >= totalLogical - 1}
                            className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded disabled:opacity-40 hover:bg-slate-300 transition-colors text-sm"
                        >
                            Next →
                        </button>
                    </div>

                    {/* Jump + bookmarks */}
                    <div className="flex items-center gap-2">
                        <ShowBookmarksButton
                            hasBookmarks={bookmarks.length > 0}
                            onClick={() => setShowBookmarksModal(true)}
                        />
                        <label className="text-sm text-slate-600">Jump:</label>
                        <input
                            type="number"
                            min={availablePages[0]}
                            max={availablePages[totalLogical - 1]}
                            value={jumpInput}
                            onChange={e => setJumpInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleJump()}
                            className="w-20 px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                        <button
                            onClick={handleJump}
                            className="px-3 py-1 text-sm bg-sky-600 text-white rounded hover:bg-sky-700 transition-colors"
                        >
                            Go
                        </button>
                    </div>

                    {/* Save */}
                    <button
                        onClick={handleSave}
                        disabled={blocksLoading || blocks.length === 0 || editedCount === 0}
                        className="px-4 py-1.5 bg-green-600 text-white text-sm font-semibold rounded hover:bg-green-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
                    >
                        Save Page{editedCount > 0 && ` (${editedCount} edited)`}
                    </button>
                </div>
            )}

            {/* Save status */}
            {saveStatus && (
                <div className={`mx-4 mt-3 px-4 py-2 rounded text-sm ${saveStatus.ok
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : 'bg-red-50 border border-red-200 text-red-800'}`}>
                    {saveStatus.message}
                </div>
            )}

            {/* Two-column body */}
            {!metaLoading && !metaError && totalLogical > 0 && (
                <div className="flex flex-col lg:flex-row min-h-[600px]">

                    {/* ── Left: PDF image ── */}
                    <div className="flex-1 min-w-0 lg:w-1/2 p-4 border-r border-slate-200">
                        <h3 className="text-base font-semibold text-slate-700 mb-3">PDF Preview</h3>
                        <div className="bg-slate-100 border border-slate-300 rounded-lg overflow-hidden flex items-start justify-center min-h-[560px] max-h-[720px]">
                            {imageLoading ? (
                                <div className="flex flex-col items-center justify-center h-full py-16 gap-3">
                                    <Spinner />
                                    <span className="text-slate-500 text-sm">Rendering page…</span>
                                </div>
                            ) : pdfDataUrl ? (
                                <div className="overflow-y-auto max-h-[720px] w-full flex justify-center p-2">
                                    <img
                                        src={pdfDataUrl}
                                        alt={`Logical page ${currentLogicalPage}`}
                                        className="max-w-full h-auto shadow"
                                    />
                                </div>
                            ) : (
                                <div className="flex items-center justify-center h-full py-16 text-slate-400 text-sm">
                                    No image
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Right: Annotation panel ── */}
                    <div className="flex-1 min-w-0 lg:w-1/2 p-4">
                        {/* Heading + file path */}
                        <div className="mb-3">
                            <h3 className="text-base font-semibold text-slate-700 inline">
                                Blocks
                            </h3>
                            {blocks.length > 0 && (
                                <span className="ml-2 text-xs font-normal text-slate-400">
                                    ({blocks.length} block{blocks.length !== 1 ? 's' : ''})
                                </span>
                            )}
                            {pageFilePath && (
                                <p className="mt-0.5 text-xs text-slate-400 font-mono truncate" title={pageFilePath}>
                                    {pageFilePath}
                                </p>
                            )}
                        </div>

                        {blocksLoading && (
                            <div className="flex items-center gap-2 py-8 justify-center">
                                <Spinner />
                                <span className="text-slate-500 text-sm">Loading blocks…</span>
                            </div>
                        )}

                        {blocksError && (
                            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
                                {blocksError}
                            </div>
                        )}

                        {!blocksLoading && !blocksError && blocks.length === 0 && (
                            <div className="text-slate-400 text-sm text-center py-12">
                                No blocks found for this page.
                            </div>
                        )}

                        {!blocksLoading && !blocksError && blocks.length > 0 && (
                            <div className="space-y-3 overflow-y-auto max-h-[720px] pr-1">
                                {blocks.map((block, idx) => {
                                    const isEdited = block.type !== originalTypes[idx];
                                    const originalType = originalTypes[idx];
                                    return (
                                        <div
                                            key={idx}
                                            className={`rounded-lg p-3 border ${
                                                isEdited
                                                    ? 'border-slate-200 border-l-4 border-l-amber-400'
                                                    : 'border-slate-200'
                                            }`}
                                            style={{ backgroundColor: 'var(--bg-surface)' }}
                                        >
                                            <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap font-mono mb-2">
                                                {block.text}
                                            </p>
                                            {/* Type selector row */}
                                            <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-slate-200">
                                                {/* 1. Current type — always first, full text + colour */}
                                                <button
                                                    onClick={() => reclassify(idx, block.type)}
                                                    title={block.type}
                                                    className={`px-2 py-0.5 text-xs border rounded-full transition-colors font-semibold ring-1 ring-offset-1 ring-current ${
                                                        TYPE_COLOURS[block.type] || 'bg-slate-100 text-slate-700 border-slate-300'
                                                    }`}
                                                >
                                                    {block.type}
                                                </button>

                                                {/* 2. Original type — grey, full text, only when edited; click to restore */}
                                                {isEdited && (
                                                    <button
                                                        onClick={() => reclassify(idx, originalType)}
                                                        title={`Restore: ${originalType}`}
                                                        className="px-2 py-0.5 text-xs border rounded-full bg-slate-100 text-slate-400 border-slate-300 hover:bg-slate-200 transition-colors"
                                                    >
                                                        {originalType}
                                                    </button>
                                                )}

                                                {/* 3. Remaining types as initials, excluding current */}
                                                {blockTypes.filter(t => t !== block.type).map(t => (
                                                    <button
                                                        key={t}
                                                        onClick={() => reclassify(idx, t)}
                                                        title={t}
                                                        className={`px-2 py-0.5 text-xs border rounded-full transition-colors ${
                                                            TYPE_COLOURS[t] || 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                                                        }`}
                                                    >
                                                        {TYPE_ABBR[t] || t}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Bookmarks modal */}
            {showBookmarksModal && (
                <BookmarksModal
                    isOpen={showBookmarksModal}
                    onClose={() => setShowBookmarksModal(false)}
                    bookmarks={bookmarks}
                    onBookmarkClick={handleBookmarkClick}
                    title={selectedFile?.selectedPDFFile
                        ? `Bookmarks — ${selectedFile.selectedPDFFile}`
                        : 'PDF Bookmarks'}
                />
            )}
        </div>
    );
};

export default ParaClassifier;
