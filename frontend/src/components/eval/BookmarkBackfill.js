/**
 * BookmarkBackfill
 *
 * Eval tab for manually backfilling parsed bookmarks via Gemini.
 *
 * Left  — list of PDFs that have no parsed_bookmarks in the DB
 *          (ignore_bookmarks=false, fetched from backend)
 * Right — raw indexed_titles JSON to copy into Gemini (top)
 *          + paste area for Gemini's response + Save to DB (bottom)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Spinner } from '../SharedComponents';

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

const enc = (s) => encodeURIComponent(s);

async function apiFetch(url, options) {
    const r = await fetch(url, options);
    if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${r.status}`);
    }
    return r.json();
}

// ─── File list item ───────────────────────────────────────────────────────────

const FileRow = ({ filePath, isSelected, isSaved, onClick }) => {
    const parts = filePath.replace(/\\/g, '/').split('/');
    const filename = parts[parts.length - 1];
    const folder = parts.slice(0, -1).join('/');

    return (
        <button
            onClick={() => !isSaved && onClick(filePath)}
            disabled={isSaved}
            className={`w-full text-left px-3 py-2.5 border-b border-slate-100 transition-colors
                ${isSaved
                    ? 'opacity-40 cursor-default bg-green-50'
                    : isSelected
                        ? 'bg-sky-50 border-l-2 border-sky-500'
                        : 'hover:bg-slate-50 border-l-2 border-transparent'
                }`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{filename}</div>
                    <div className="text-xs text-slate-400 font-mono truncate mt-0.5">{folder}</div>
                </div>
                {isSaved && (
                    <span className="flex-shrink-0 text-green-600 mt-0.5">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </span>
                )}
            </div>
        </button>
    );
};

// ─── Copy button ──────────────────────────────────────────────────────────────

const CopyButton = ({ text }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // fallback
        }
    };

    return (
        <button
            onClick={handleCopy}
            className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
        >
            {copied ? (
                <>
                    <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-green-600">Copied!</span>
                </>
            ) : (
                <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>Copy</span>
                </>
            )}
        </button>
    );
};

// ─── Main component ───────────────────────────────────────────────────────────

const BookmarkBackfill = () => {
    // ── candidate list ────────────────────────────────────────────────────────
    const [files, setFiles]           = useState([]);
    const [listLoading, setListLoading] = useState(false);
    const [listError, setListError]   = useState(null);
    const [savedFiles, setSavedFiles] = useState(new Set());

    // ── selected file ─────────────────────────────────────────────────────────
    const [selectedFile, setSelectedFile]       = useState(null);
    const [rawTitles, setRawTitles]             = useState(null);   // array
    const [rawLoading, setRawLoading]           = useState(false);
    const [rawError, setRawError]               = useState(null);

    // ── paste area ────────────────────────────────────────────────────────────
    const [pasteText, setPasteText]   = useState('');
    const [pasteValid, setPasteValid] = useState(null);  // null | true | false
    const [parsedBookmarks, setParsedBookmarks] = useState(null);

    // ── save ──────────────────────────────────────────────────────────────────
    const [saveStatus, setSaveStatus] = useState(null);  // null | {ok, message}
    const [saving, setSaving]         = useState(false);

    const pasteRef = useRef(null);

    // ── Load candidates ───────────────────────────────────────────────────────
    const loadCandidates = useCallback(async () => {
        setListLoading(true);
        setListError(null);
        try {
            const data = await apiFetch(`${API_BASE_URL}/eval/bookmarks/backfill-candidates`);
            setFiles(data.files || []);
        } catch (err) {
            setListError(err.message);
        } finally {
            setListLoading(false);
        }
    }, []);

    useEffect(() => { loadCandidates(); }, [loadCandidates]);

    // ── Select a file → fetch raw bookmarks ───────────────────────────────────
    const handleSelectFile = useCallback(async (filePath) => {
        setSelectedFile(filePath);
        setRawTitles(null);
        setRawError(null);
        setRawLoading(true);
        setPasteText('');
        setPasteValid(null);
        setParsedBookmarks(null);
        setSaveStatus(null);

        try {
            const data = await apiFetch(
                `${API_BASE_URL}/eval/bookmarks/raw?file_path=${enc(filePath)}`
            );
            setRawTitles(data.indexed_titles || []);
        } catch (err) {
            setRawError(err.message);
        } finally {
            setRawLoading(false);
        }
    }, []);

    // ── Validate paste text ───────────────────────────────────────────────────
    const handlePasteChange = (e) => {
        const text = e.target.value;
        setPasteText(text);
        setSaveStatus(null);

        if (!text.trim()) {
            setPasteValid(null);
            setParsedBookmarks(null);
            return;
        }

        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed) && parsed.length > 0) {
                setPasteValid(true);
                setParsedBookmarks(parsed);
            } else {
                setPasteValid(false);
                setParsedBookmarks(null);
            }
        } catch {
            setPasteValid(false);
            setParsedBookmarks(null);
        }
    };

    // ── Save ──────────────────────────────────────────────────────────────────
    const handleSave = async () => {
        if (!parsedBookmarks || !selectedFile) return;

        setSaving(true);
        setSaveStatus(null);

        try {
            const data = await apiFetch(`${API_BASE_URL}/eval/bookmarks/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file_path: selectedFile,
                    bookmarks: parsedBookmarks,
                }),
            });

            setSaveStatus({ ok: true, message: `Saved ${data.count} bookmark(s) to DB.` });
            setSavedFiles(prev => new Set([...prev, selectedFile]));
        } catch (err) {
            setSaveStatus({ ok: false, message: err.message });
        } finally {
            setSaving(false);
        }
    };

    // ── Raw JSON string for display ───────────────────────────────────────────
    const rawJson = rawTitles ? JSON.stringify(rawTitles, null, 2) : '';

    const pendingCount = files.filter(f => !savedFiles.has(f)).length;

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="rounded-lg shadow-sm border border-slate-200" style={{ backgroundColor: 'var(--bg-card)' }}>

            {/* ── Header ── */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Bookmark Backfill</h2>
                    <p className="text-slate-500 text-sm mt-0.5">
                        Copy raw bookmarks → paste into Gemini → save the response back to DB
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {!listLoading && files.length > 0 && (
                        <span className="text-sm text-slate-600">
                            <span className="font-semibold text-slate-800">{pendingCount}</span>
                            {' '}of{' '}
                            <span className="font-semibold text-slate-800">{files.length}</span>
                            {' '}remaining
                        </span>
                    )}
                    <button
                        onClick={loadCandidates}
                        disabled={listLoading}
                        className="flex items-center gap-2 bg-sky-600 text-white text-sm font-medium px-3 py-1.5 rounded-md hover:bg-sky-700 disabled:opacity-50 transition-colors"
                    >
                        <svg className={`w-4 h-4 ${listLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        {listLoading ? 'Loading...' : 'Refresh'}
                    </button>
                </div>
            </div>

            {/* ── Two-column body ── */}
            <div className="flex flex-col lg:flex-row min-h-[600px]">

                {/* ── Left: file list ── */}
                <div className="lg:w-1/3 border-r border-slate-200 flex flex-col">
                    <div className="px-3 py-2 border-b border-slate-100 text-xs font-medium text-slate-500 uppercase tracking-wider"
                         style={{ backgroundColor: 'var(--bg-surface)' }}>
                        Files without bookmarks
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {/* Loading skeleton */}
                        {listLoading && (
                            <div className="p-3 space-y-2">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div key={i} className="animate-pulse">
                                        <div className="h-3.5 bg-slate-200 rounded w-3/4 mb-1.5" />
                                        <div className="h-2.5 bg-slate-100 rounded w-full" />
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Error */}
                        {listError && (
                            <div className="m-3 px-3 py-2 rounded text-sm bg-red-50 border border-red-200 text-red-800">
                                {listError}
                            </div>
                        )}

                        {/* Empty state */}
                        {!listLoading && !listError && files.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                                <svg className="w-12 h-12 text-green-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <p className="text-green-800 font-medium text-sm">All files have bookmarks!</p>
                            </div>
                        )}

                        {/* File rows */}
                        {!listLoading && files.map(f => (
                            <FileRow
                                key={f}
                                filePath={f}
                                isSelected={selectedFile === f}
                                isSaved={savedFiles.has(f)}
                                onClick={handleSelectFile}
                            />
                        ))}
                    </div>
                </div>

                {/* ── Right: work area ── */}
                <div className="flex-1 min-w-0 flex flex-col">

                    {/* No file selected */}
                    {!selectedFile && (
                        <div className="flex flex-col items-center justify-center flex-1 py-16 px-8 text-center">
                            <svg className="mx-auto h-16 w-16 text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <h3 className="text-lg font-semibold text-slate-700 mb-2">No file selected</h3>
                            <p className="text-slate-500 text-sm">Pick a file from the list on the left.</p>
                        </div>
                    )}

                    {/* Work area */}
                    {selectedFile && (
                        <div className="flex flex-col flex-1 divide-y divide-slate-200">

                            {/* ── Top: raw bookmarks ── */}
                            <div className="p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-sm font-semibold text-slate-700">
                                            Raw Bookmarks
                                        </h3>
                                        {rawTitles && (
                                            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                                                {rawTitles.length} entries
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs text-slate-400">Copy → paste into Gemini</span>
                                        {rawTitles && rawTitles.length > 0 && (
                                            <CopyButton text={rawJson} />
                                        )}
                                    </div>
                                </div>

                                {rawLoading && (
                                    <div className="flex items-center gap-2 py-6 justify-center">
                                        <Spinner />
                                        <span className="text-slate-500 text-sm">Extracting bookmarks…</span>
                                    </div>
                                )}

                                {rawError && (
                                    <div className="px-3 py-2 rounded text-sm bg-red-50 border border-red-200 text-red-800">
                                        {rawError}
                                    </div>
                                )}

                                {!rawLoading && rawTitles && rawTitles.length === 0 && (
                                    <div className="px-3 py-2 rounded text-sm bg-yellow-50 border border-yellow-200 text-yellow-800">
                                        This PDF has no TOC bookmarks — nothing to extract.
                                    </div>
                                )}

                                {!rawLoading && rawTitles && rawTitles.length > 0 && (
                                    <textarea
                                        readOnly
                                        value={rawJson}
                                        className="w-full h-48 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded resize-none focus:outline-none text-slate-700"
                                    />
                                )}
                            </div>

                            {/* ── Bottom: paste + save ── */}
                            <div className="p-4 flex flex-col flex-1">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-sm font-semibold text-slate-700">
                                        Paste Gemini Response
                                    </h3>
                                    {pasteValid === true && (
                                        <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                            Valid JSON · {parsedBookmarks.length} items
                                        </span>
                                    )}
                                    {pasteValid === false && (
                                        <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                            Invalid JSON
                                        </span>
                                    )}
                                </div>

                                <textarea
                                    ref={pasteRef}
                                    value={pasteText}
                                    onChange={handlePasteChange}
                                    placeholder='Paste the JSON array from Gemini here…'
                                    className={`w-full h-48 px-3 py-2 text-xs font-mono border rounded resize-none focus:outline-none transition-colors
                                        ${pasteValid === true
                                            ? 'border-green-400 bg-green-50 focus:ring-1 focus:ring-green-400'
                                            : pasteValid === false
                                                ? 'border-red-400 bg-red-50 focus:ring-1 focus:ring-red-400'
                                                : 'border-slate-200 bg-white focus:ring-1 focus:ring-sky-400'
                                        }`}
                                />

                                {/* Save status */}
                                {saveStatus && (
                                    <div className={`mt-3 px-3 py-2 rounded text-sm ${
                                        saveStatus.ok
                                            ? 'bg-green-50 border border-green-200 text-green-800'
                                            : 'bg-red-50 border border-red-200 text-red-800'
                                    }`}>
                                        {saveStatus.message}
                                    </div>
                                )}

                                {/* Save button */}
                                <div className="mt-3 flex justify-end">
                                    <button
                                        onClick={handleSave}
                                        disabled={!pasteValid || saving}
                                        className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded hover:bg-green-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
                                    >
                                        {saving ? (
                                            <>
                                                <Spinner />
                                                <span>Saving…</span>
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                                </svg>
                                                Save to DB
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BookmarkBackfill;
