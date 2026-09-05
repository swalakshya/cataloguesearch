import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Spinner } from '../SharedComponents';
import ShowBookmarksButton from '../ShowBookmarksButton';
import BookmarksModal from '../BookmarksModal';
import ParseBookmarksControl from '../ParseBookmarksControl';
import FileOrUrlInput from './FileOrUrlInput';
import usePDFViewer from '../../hooks/usePDFViewer';
import useMultiPageSplit from '../../hooks/useMultiPageSplit';
import useArrowNavigation from '../../hooks/useArrowNavigation';

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

// Tesseract paragraph type styles
const PARAGRAPH_TYPE_STYLES = {
    STANDARD_PROSE: { label: 'Prose', bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-800',   badge: 'bg-blue-100 text-blue-700' },
    VERSE_BLOCK:    { label: 'Verse', bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-800',  badge: 'bg-amber-100 text-amber-700' },
    QA_BLOCK:       { label: 'Q&A',   bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800', badge: 'bg-purple-100 text-purple-700' },
};
const DEFAULT_PARAGRAPH_STYLE = { label: null, bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-800', badge: '' };

// LLM block type styles
const BLOCK_TYPE_STYLES = {
    chapter_heading: { label: 'Chapter Heading', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800', badge: 'bg-purple-100 text-purple-700' },
    sanskrit_text:   { label: 'Sanskrit Text',   bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', badge: 'bg-orange-100 text-orange-700' },
    sanskrit_verse:  { label: 'Sanskrit Verse',  bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-800',  badge: 'bg-amber-100 text-amber-700' },
    prakrit_text:    { label: 'Prakrit Text',    bg: 'bg-teal-50',   border: 'border-teal-200',   text: 'text-teal-800',   badge: 'bg-teal-100 text-teal-700' },
    prakrit_verse:   { label: 'Prakrit Verse',   bg: 'bg-cyan-50',   border: 'border-cyan-200',   text: 'text-cyan-800',   badge: 'bg-cyan-100 text-cyan-700' },
    hindi_text:      { label: 'Hindi Text',      bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-800',   badge: 'bg-blue-100 text-blue-700' },
    hindi_verse:     { label: 'Hindi Verse',     bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-800', badge: 'bg-indigo-100 text-indigo-700' },
    footnote:        { label: 'Footnote',        bg: 'bg-slate-50',  border: 'border-slate-300',  text: 'text-slate-700',  badge: 'bg-slate-200 text-slate-600' },
};
const DEFAULT_BLOCK_STYLE = { label: 'Unknown', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-800', badge: 'bg-gray-100 text-gray-700' };

const PDFParser = ({ selectedFile: propSelectedFile, onFileSelect, basePaths, baseDirectoryHandles, onPdfParentDirChange }) => {
    // Mode
    const [mode, setMode] = useState('tesseract'); // 'tesseract' | 'llm'

    // Shared state
    const [selectedFile, setSelectedFile] = useState(null);
    const [isPDF, setIsPDF] = useState(false);
    const [language, setLanguage] = useState('hin');
    const [cropTop, setCropTop] = useState(0);
    const [cropBottom, setCropBottom] = useState(0);
    const [cropLeft, setCropLeft] = useState(0);
    const [cropRight, setCropRight] = useState(0);
    const [useDefaultScanConfig, setUseDefaultScanConfig] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);
    const [showBookmarkModal, setShowBookmarkModal] = useState(false);
    const [activeResultTab, setActiveResultTab] = useState('preview');
    const [jumpPageNumber, setJumpPageNumber] = useState('');

    // LLM-specific
    const [modelName, setModelName] = useState('gemini-2.5-flash');

    // Batch state (tesseract only)
    const [batchJobId, setBatchJobId] = useState(null);
    const [batchJobStatus, setBatchJobStatus] = useState(null);
    const [batchProgress, setBatchProgress] = useState(0);
    const [batchTotalPages, setBatchTotalPages] = useState(0);
    const [batchZipFilename, setBatchZipFilename] = useState(null);
    const [batchElapsedTime, setBatchElapsedTime] = useState(null);

    const croppedImageContainerRef = useRef(null);
    const pollingIntervalRef = useRef(null);

    const pdfViewer = usePDFViewer({ setError });
    const { pdfDoc, currentPage, totalPages, previewUrl, croppedPreviewUrl, bookmarks, setCroppedPreviewUrl } = pdfViewer;

    const { multiPagePDF, setMultiPagePDF, splitPct, setSplitPct, splitPreviewUrls, splitImageFile } =
        useMultiPageSplit({ previewUrl, croppedPreviewUrl });
    const [activeHalf, setActiveHalf] = useState('left');

    // Reset results and tab when mode changes
    useEffect(() => {
        setResults(null);
        setActiveResultTab('preview');
        resetBatchState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    // Cleanup polling on unmount
    useEffect(() => {
        return () => { if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current); };
    }, []);

    // Load file from file browser (propSelectedFile)
    useEffect(() => {
        if (propSelectedFile && propSelectedFile.selectedPDFFile &&
            (!selectedFile || selectedFile.name !== propSelectedFile.selectedPDFFile)) {
            const load = async () => {
                try {
                    if (baseDirectoryHandles?.pdf) {
                        resetAllState();
                        setIsLoading(true);
                        const pathParts = propSelectedFile.relativePath.split('/');
                        const pdfDirectory = pathParts.slice(0, -1).join('/');
                        let currentHandle = baseDirectoryHandles.pdf;
                        for (const segment of pdfDirectory.split('/').filter(s => s.length > 0)) {
                            currentHandle = await currentHandle.getDirectoryHandle(segment);
                        }
                        if (onPdfParentDirChange) onPdfParentDirChange(pdfDirectory);
                        const pdfFileHandle = await currentHandle.getFileHandle(propSelectedFile.selectedPDFFile);
                        const pdfFile = await pdfFileHandle.getFile();
                        setSelectedFile(pdfFile);
                        setIsPDF(true);
                        await pdfViewer.loadPDF(pdfFile);
                        setIsLoading(false);
                    } else if (propSelectedFile.selectedPDFFile) {
                        setError('Directory permissions not granted. Please grant permissions on the Home tab first.');
                    }
                } catch (err) {
                    setError(`Error loading file from browser: ${err.message}`);
                    setIsLoading(false);
                }
            };
            load();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propSelectedFile, baseDirectoryHandles]);

    // Batch job polling
    useEffect(() => {
        if (batchJobId && ['queued', 'preparing', 'processing', 'canceling'].includes(batchJobStatus)) {
            pollingIntervalRef.current = setInterval(async () => {
                try {
                    const res = await fetch(`${API_BASE_URL}/eval/ocr/batch/status/${batchJobId}`);
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.detail || 'Failed to get job status.');
                    setBatchJobStatus(data.status);
                    setBatchProgress(data.progress);
                    setBatchTotalPages(data.total_pages);
                    setBatchElapsedTime(data.elapsed_time_formatted);
                    if (data.status === 'completed') setBatchZipFilename(data.zip_filename);
                    if (['completed', 'failed', 'canceled'].includes(data.status)) {
                        clearInterval(pollingIntervalRef.current);
                        setIsLoading(false);
                        if (data.status === 'failed') setError(`Batch processing failed: ${data.error}`);
                    }
                } catch (err) {
                    setError(`Error polling job status: ${err.message}`);
                    clearInterval(pollingIntervalRef.current);
                    setIsLoading(false);
                }
            }, 3000);
        }
        return () => { if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current); };
    }, [batchJobId, batchJobStatus]);

    const resetBatchState = () => {
        setBatchJobId(null);
        setBatchJobStatus(null);
        setBatchProgress(0);
        setBatchTotalPages(0);
        setBatchZipFilename(null);
        setBatchElapsedTime(null);
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };

    const resetAllState = () => {
        setSelectedFile(null);
        setIsPDF(false);
        setShowBookmarkModal(false);
        setResults(null);
        setError(null);
        setIsLoading(false);
        resetBatchState();
    };

    const handleFileReady = async (file) => {
        if (onFileSelect) onFileSelect(null);
        resetAllState();
        setSelectedFile(file);
        const isFilePDF = file.type === 'application/pdf';
        setIsPDF(isFilePDF);
        if (isFilePDF) await pdfViewer.loadPDF(file);
        else pdfViewer.loadImagePreview(file);
    };

    // Wrapped in useCallback to satisfy exhaustive-deps below, but this doesn't
    // achieve true stability: pdfViewer is a fresh object every render (usePDFViewer
    // returns a plain object literal, not memoized), so this -- and the two
    // callbacks below that depend on it -- still change every render regardless.
    // Fixing that for real would mean memoizing usePDFViewer's return value,
    // which is shared with other consumers and out of scope here. useArrowNavigation
    // only uses these to add/remove a keydown listener, so the extra churn is
    // harmless, not a risk of a render loop.
    const handlePageNavigation = useCallback(async (direction) => {
        await pdfViewer.handlePageNavigation(direction, cropTop, cropBottom, () => setResults(null));
    }, [pdfViewer, cropTop, cropBottom]);

    useArrowNavigation(
        useCallback(() => handlePageNavigation('prev'), [handlePageNavigation]),
        useCallback(() => handlePageNavigation('next'), [handlePageNavigation]),
        !!pdfDoc,
    );

    const jumpToPage = async () => {
        await pdfViewer.jumpToPage(jumpPageNumber, cropTop, cropBottom, () => setResults(null));
        setJumpPageNumber('');
    };

    const handleApply = () => {
        if (!selectedFile) return;
        if (cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0)
            pdfViewer.applyCropToDataUrl(previewUrl, cropTop, cropBottom, cropLeft, cropRight);
        else setCroppedPreviewUrl(null);
        setResults(null);
        setActiveResultTab('preview');
    };

    const handleBookmarkClick = (bookmark) => {
        pdfViewer.navigateToBookmark(bookmark, () => setResults(null));
    };

    const convertCurrentPageToImage = async () => {
        if (!pdfDoc) return null;
        try {
            const page = await pdfDoc.getPage(currentPage);
            const scale = 1.5;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            return new Promise((resolve) => {
                canvas.toBlob((blob) => resolve(new File([blob], `page_${currentPage}.png`, { type: 'image/png' })), 'image/png');
            });
        } catch (err) {
            setError(`Error converting PDF page: ${err.message}`);
            return null;
        }
    };

    const callOCRApi = async (imageFile) => {
        const fd = new FormData();
        fd.append('language', language);
        fd.append('crop_top', cropTop);
        fd.append('crop_bottom', cropBottom);
        fd.append('crop_left', cropLeft);
        fd.append('crop_right', cropRight);
        fd.append('mode', 'advanced');
        fd.append('image', imageFile);
        fd.append('use_default_scan_config', useDefaultScanConfig);
        const res = await fetch(`${API_BASE_URL}/eval/ocr`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || `HTTP error! status: ${res.status}`);
        return data;
    };

    // `relativePath`, when given, skips uploading imageFile entirely -- the
    // backend already has this exact PDF under BASE_PDF_PATH (that's how the
    // browser got it in the first place, via /eval/fs/read), so it reads the
    // page itself instead of receiving it back over the wire.
    const callLLMApi = async (imageFile, relativePath = null) => {
        const fd = new FormData();
        fd.append('language', language);
        fd.append('model_name', modelName);
        fd.append('crop_top', cropTop);
        fd.append('crop_bottom', cropBottom);
        fd.append('crop_left', cropLeft);
        fd.append('crop_right', cropRight);
        fd.append('page_number', currentPage);
        if (relativePath) {
            fd.append('relative_path', relativePath);
        } else {
            fd.append('use_default_scan_config', useDefaultScanConfig);
            fd.append('image', imageFile);
        }
        const res = await fetch(`${API_BASE_URL}/eval/scripture-llm`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || `HTTP error! status: ${res.status}`);
        return data;
    };

    const handleProcess = async () => {
        if (!selectedFile) { setError('Please select a file first'); return; }
        setIsLoading(true);
        setError(null);
        setResults(null);
        setCroppedPreviewUrl(null);
        resetBatchState();
        try {
            if (multiPagePDF) {
                let fullPageFile = selectedFile;
                if (isPDF) {
                    fullPageFile = await convertCurrentPageToImage();
                    if (!fullPageFile) throw new Error('Failed to convert PDF page to image');
                }
                const [leftFile, rightFile] = await Promise.all([
                    splitImageFile(fullPageFile, splitPct, 'left'),
                    splitImageFile(fullPageFile, splitPct, 'right'),
                ]);
                const apiCall = mode === 'tesseract' ? callOCRApi : callLLMApi;
                const [leftResults, rightResults] = await Promise.all([apiCall(leftFile), apiCall(rightFile)]);
                setResults({ isMultiPage: true, left: leftResults, right: rightResults });
            } else if (mode === 'tesseract') {
                const isFromBrowser = propSelectedFile?.relativePath && selectedFile?.name === propSelectedFile.selectedPDFFile;
                const formData = new FormData();
                formData.append('language', language);
                formData.append('crop_top', cropTop);
                formData.append('crop_bottom', cropBottom);
                formData.append('crop_left', cropLeft);
                formData.append('crop_right', cropRight);
                formData.append('mode', 'advanced');
                if (isFromBrowser && isPDF) {
                    formData.append('relative_path', propSelectedFile.relativePath);
                    formData.append('page_number', currentPage);
                } else {
                    let fileToProcess = selectedFile;
                    if (isPDF) {
                        fileToProcess = await convertCurrentPageToImage();
                        if (!fileToProcess) throw new Error('Failed to convert PDF page to image');
                    }
                    formData.append('image', fileToProcess);
                    formData.append('use_default_scan_config', useDefaultScanConfig);
                }
                const res = await fetch(`${API_BASE_URL}/eval/ocr`, { method: 'POST', body: formData });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || `HTTP error! status: ${res.status}`);
                setResults(data);
            } else {
                const isFromBrowser = propSelectedFile?.relativePath && selectedFile?.name === propSelectedFile.selectedPDFFile;
                if (isFromBrowser && isPDF) {
                    // Skip client-side page conversion entirely -- the backend extracts
                    // the page itself from the same PDF it already has on disk.
                    const data = await callLLMApi(null, propSelectedFile.relativePath);
                    setResults(data);
                } else {
                    let fileToProcess = selectedFile;
                    if (isPDF) {
                        fileToProcess = await convertCurrentPageToImage();
                        if (!fileToProcess) throw new Error('Failed to convert PDF page to image');
                    }
                    const data = await callLLMApi(fileToProcess);
                    setResults(data);
                }
            }
            setActiveResultTab(mode === 'tesseract' ? 'paragraphs' : 'llm-results');
        } catch (err) {
            setError(`Processing failed: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleBatchProcess = async () => {
        if (!selectedFile || !isPDF) { setError('Please select a PDF file for batch processing.'); return; }
        setIsLoading(true);
        setError(null);
        setResults(null);
        resetBatchState();
        try {
            const isFromBrowser = propSelectedFile?.relativePath && selectedFile?.name === propSelectedFile.selectedPDFFile;
            const formData = new FormData();
            if (isFromBrowser) {
                // The backend already has this PDF under BASE_PDF_PATH; skip re-uploading
                // a whole book's worth of pages the browser only just downloaded from it.
                formData.append('relative_path', propSelectedFile.relativePath);
            } else {
                formData.append('file', selectedFile);
            }
            formData.append('language', language);
            formData.append('use_google_ocr', false);
            const res = await fetch(`${API_BASE_URL}/eval/ocr/batch`, { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to start batch job.');
            setBatchJobId(data.job_id);
            setBatchJobStatus(data.status || 'queued');
        } catch (err) {
            setError(`Failed to start batch job: ${err.message}`);
            setIsLoading(false);
        }
    };

    const handleCancelBatchJob = async () => {
        if (!batchJobId) return;
        try {
            setBatchJobStatus('canceling');
            const res = await fetch(`${API_BASE_URL}/eval/ocr/batch/cancel/${batchJobId}`, { method: 'POST' });
            if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed to cancel.'); }
        } catch (err) {
            setError(`Error canceling job: ${err.message}`);
        }
    };

    const handleCopyText = (text, e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).catch(console.error);
    };

    // ── Small reusable pieces ────────────────────────────────────────────────

    const CopyButton = ({ text }) => (
        <button onClick={(e) => handleCopyText(text, e)}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-colors" title="Copy">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
        </button>
    );

    const ProgressBar = ({ progress, total }) => {
        const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
        return (
            <div className="w-full bg-slate-200 rounded-full h-2.5">
                <div className="bg-sky-600 h-2.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
        );
    };

    const renderParagraphList = (paragraphs) => {
        if (!paragraphs?.length) return <div className="text-center py-4 text-slate-400 text-sm">No text detected.</div>;
        return paragraphs.map((para, i) => {
            const style = PARAGRAPH_TYPE_STYLES[para.paragraph_type] || DEFAULT_PARAGRAPH_STYLE;
            return (
                <div key={i} className={`${style.bg} border ${style.border} rounded-lg p-3`}>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-semibold ${style.text}`}>Paragraph {i + 1}</span>
                            {style.label && <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${style.badge}`}>{style.label}</span>}
                        </div>
                        <CopyButton text={para.text} />
                    </div>
                    <div className={`text-sm ${style.text} whitespace-pre-wrap font-mono`}>{para.text}</div>
                </div>
            );
        });
    };

    const renderBlockList = (blocks) => {
        if (!blocks?.length) return <div className="text-center py-4 text-slate-400 text-sm">No text detected.</div>;
        return blocks.map((block, i) => {
            const style = BLOCK_TYPE_STYLES[block.type] || DEFAULT_BLOCK_STYLE;
            return (
                <div key={i} className={`${style.bg} border ${style.border} rounded-lg p-3`}>
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${style.badge}`}>{style.label}</span>
                        <CopyButton text={block.text} />
                    </div>
                    <div className={`text-sm ${style.text} whitespace-pre-wrap font-mono`}>{block.text}</div>
                </div>
            );
        });
    };

    // ── Derived values ───────────────────────────────────────────────────────

    const tabs = mode === 'tesseract'
        ? [
            { id: 'preview',     label: 'OCR Preview' },
            { id: 'ocr-json',    label: 'Raw OCR JSON' },
            { id: 'scan-config', label: 'Scan Config' },
            { id: 'paragraphs',  label: 'Paragraphs' },
          ]
        : [
            { id: 'preview',     label: 'OCR Preview' },
            { id: 'llm-results', label: 'LLM Results' },
            { id: 'scan-config', label: 'Scan Config' },
          ];

    const activeData = results?.isMultiPage ? results[activeHalf] : results;
    const scanConfig = activeData?.scan_config ?? null;
    const previewImageSrc = (() => {
        if (multiPagePDF && splitPreviewUrls?.[activeHalf]) return splitPreviewUrls[activeHalf];
        if (croppedPreviewUrl) return croppedPreviewUrl;
        if (mode === 'llm' && activeData?.preview_image) return `data:image/png;base64,${activeData.preview_image}`;
        return previewUrl;
    })();

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div>
            <BookmarksModal
                isOpen={showBookmarkModal}
                onClose={() => setShowBookmarkModal(false)}
                bookmarks={bookmarks}
                onBookmarkClick={handleBookmarkClick}
            />

            <div className="rounded-lg shadow-sm border border-slate-200" style={{ width: '130%', maxWidth: 'none', backgroundColor: 'var(--bg-card)' }}>
                {/* Header */}
                <div className="p-4 border-b border-slate-200">
                    <h2 className="text-2xl font-bold text-slate-800 mb-1">PDF Parser</h2>
                    <p className="text-slate-600 text-sm">Extract text from PDF pages using Tesseract OCR or Gemini LLM</p>
                </div>

                {/* Controls */}
                <div className="px-4 pt-3 pb-2 border-b border-slate-200 space-y-2" style={{ backgroundColor: 'var(--bg-surface)' }}>

                    {/* Line 1: File input + language */}
                    <div>
                        <FileOrUrlInput
                            onFileReady={handleFileReady}
                            selectedFile={selectedFile}
                            inputId="pdf-parser-file-upload"
                            language={language}
                            onLanguageChange={setLanguage}
                        />
                        {propSelectedFile && (
                            <div className={`mt-1 px-2 py-0.5 border rounded text-xs ${
                                selectedFile?.name === propSelectedFile.selectedPDFFile
                                    ? 'bg-green-50 border-green-200 text-green-800'
                                    : 'bg-blue-50 border-blue-200 text-blue-700'
                            }`}>
                                {propSelectedFile.selectedPDFFile || 'Unknown'}
                            </div>
                        )}
                    </div>

                    {/* Line 2: Mode + Crop + Multi-page + (Model if LLM) + Scan config + Apply */}
                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Mode toggle */}
                        <div className="flex rounded-md overflow-hidden border border-slate-300">
                            <button onClick={() => setMode('tesseract')}
                                className={`px-3 py-1 text-xs ${mode === 'tesseract' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                                Tesseract
                            </button>
                            <button onClick={() => setMode('llm')}
                                className={`px-3 py-1 text-xs border-l border-slate-300 ${mode === 'llm' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                                LLM
                            </button>
                        </div>

                        <div className="flex items-center gap-1">
                            <label className="text-xs text-slate-500 whitespace-nowrap">Top %</label>
                            <input type="number" step="1" min="0" max="50" value={cropTop}
                                onChange={(e) => setCropTop(parseInt(e.target.value) || 0)}
                                className="w-16 text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500" />
                        </div>
                        <div className="flex items-center gap-1">
                            <label className="text-xs text-slate-500 whitespace-nowrap">Bottom %</label>
                            <input type="number" step="1" min="0" max="50" value={cropBottom}
                                onChange={(e) => setCropBottom(parseInt(e.target.value) || 0)}
                                className="w-16 text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500" />
                        </div>
                        <div className="flex items-center gap-1">
                            <label className="text-xs text-slate-500 whitespace-nowrap">Left %</label>
                            <input type="number" step="1" min="0" max="50" value={cropLeft}
                                onChange={(e) => setCropLeft(parseInt(e.target.value) || 0)}
                                className="w-16 text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500" />
                        </div>
                        <div className="flex items-center gap-1">
                            <label className="text-xs text-slate-500 whitespace-nowrap">Right %</label>
                            <input type="number" step="1" min="0" max="50" value={cropRight}
                                onChange={(e) => setCropRight(parseInt(e.target.value) || 0)}
                                className="w-16 text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500" />
                        </div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                            <input type="checkbox" checked={multiPagePDF} onChange={(e) => setMultiPagePDF(e.target.checked)}
                                className="h-3.5 w-3.5 text-sky-600 border-slate-300 rounded" />
                            Multi-page PDF
                        </label>
                        {multiPagePDF && (
                            <div className="flex items-center gap-1">
                                <label className="text-xs text-slate-500 whitespace-nowrap">Split %</label>
                                <input type="number" step="1" min="10" max="90" value={splitPct}
                                    onChange={(e) => setSplitPct(parseFloat(e.target.value) || 50)}
                                    className="w-16 text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500" />
                            </div>
                        )}
                        {mode === 'llm' && (
                            <select value={modelName} onChange={(e) => setModelName(e.target.value)}
                                className="text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500">
                                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                                <option value="gemini-3-flash-preview">Gemini 3 Flash (Preview)</option>
                                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                                <option value="claude-opus-4-6">Claude Opus 4.6</option>
                                <option value="gpt-4o-mini">GPT-4o Mini</option>
                                <option value="gpt-4o">GPT-4o</option>
                            </select>
                        )}
                        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                            <input type="checkbox" checked={useDefaultScanConfig} onChange={(e) => setUseDefaultScanConfig(e.target.checked)}
                                className="h-3.5 w-3.5 text-sky-600 border-slate-300 rounded" />
                            Default scan config
                        </label>
                        <button onClick={handleApply} disabled={!selectedFile}
                            className="text-xs px-3 py-1.5 bg-slate-600 text-white rounded-md hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors">
                            Apply
                        </button>
                    </div>

                    {/* Line 3: Page nav + bookmarks + Process + Batch */}
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            {isPDF && pdfDoc && (
                                <>
                                    <button onClick={() => pdfViewer.jumpToPage(1, cropTop, cropBottom, () => setResults(null))} disabled={currentPage === 1}
                                        className="px-2 py-1 text-xs bg-slate-200 text-slate-700 rounded disabled:opacity-40 hover:bg-slate-300">⇤</button>
                                    <button onClick={() => handlePageNavigation('prev')} disabled={currentPage === 1}
                                        className="px-2 py-1 text-xs bg-slate-200 text-slate-700 rounded disabled:opacity-40 hover:bg-slate-300">←</button>
                                    <span className="text-xs text-slate-600">{currentPage} / {totalPages}</span>
                                    <button onClick={() => handlePageNavigation('next')} disabled={currentPage === totalPages}
                                        className="px-2 py-1 text-xs bg-slate-200 text-slate-700 rounded disabled:opacity-40 hover:bg-slate-300">→</button>
                                    <button onClick={() => pdfViewer.jumpToPage(totalPages, cropTop, cropBottom, () => setResults(null))} disabled={currentPage === totalPages}
                                        className="px-2 py-1 text-xs bg-slate-200 text-slate-700 rounded disabled:opacity-40 hover:bg-slate-300">⇥</button>
                                    <input type="number" min="1" max={totalPages} value={jumpPageNumber}
                                        onChange={(e) => setJumpPageNumber(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && jumpToPage()}
                                        placeholder="Go to"
                                        className="w-16 text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500" />
                                </>
                            )}
                            <ShowBookmarksButton hasBookmarks={isPDF && bookmarks.length > 0} onClick={() => setShowBookmarkModal(true)} />
                            <ParseBookmarksControl isPDF={isPDF} pdfDoc={pdfDoc} />
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={handleProcess} disabled={!selectedFile || isLoading}
                                className="text-xs px-3 py-1.5 bg-sky-600 text-white font-semibold rounded-md hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-1 transition-colors">
                                {isLoading && !batchJobId ? <><Spinner /><span>Processing…</span></> : 'Process'}
                            </button>
                            <button onClick={handleBatchProcess}
                                disabled={!selectedFile || isLoading || mode === 'llm'}
                                title={mode === 'llm' ? 'Batch not available in LLM mode' : 'Process all pages and download as ZIP'}
                                className="text-xs px-3 py-1.5 bg-slate-600 text-white font-semibold rounded-md hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-1 transition-colors">
                                {isLoading && batchJobId ? <><Spinner /><span>Batching…</span></> : 'Batch'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Batch Progress */}
                {batchJobId && (
                    <div className="p-4 border-b border-slate-200">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                                <h3 className="text-sm font-medium text-slate-700">
                                    {batchJobStatus === 'queued'     && 'Waiting for a slot…'}
                                    {batchJobStatus === 'preparing'  && 'Preparing PDF…'}
                                    {batchJobStatus === 'processing' && `Processing… (${batchProgress} / ${batchTotalPages} pages)`}
                                    {batchJobStatus === 'canceling'  && 'Canceling…'}
                                    {batchJobStatus === 'canceled'   && 'Job canceled.'}
                                    {batchJobStatus === 'completed'  && 'Processing complete!'}
                                    {batchJobStatus === 'failed'     && 'Processing failed.'}
                                </h3>
                                {batchElapsedTime && (
                                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">{batchElapsedTime}</span>
                                )}
                            </div>
                            {['processing', 'queued', 'preparing'].includes(batchJobStatus) && (
                                <button onClick={handleCancelBatchJob}
                                    className="text-sm bg-red-500 text-white font-semibold py-1 px-3 rounded-md hover:bg-red-600 transition-colors">
                                    Cancel
                                </button>
                            )}
                        </div>
                        {['processing', 'queued', 'preparing'].includes(batchJobStatus) && (
                            <ProgressBar progress={batchProgress} total={batchTotalPages} />
                        )}
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-red-800 text-sm">{error}</p>
                    </div>
                )}

                {/* Content panels */}
                <div className="flex flex-col lg:flex-row">
                    {/* Left: full-page preview */}
                    <div className="flex-1 p-4">
                        <h3 className="text-lg font-semibold text-slate-800 mb-3">Preview</h3>
                        <div className="border border-slate-300 rounded-lg overflow-hidden bg-slate-50 w-full h-[700px]">
                            {previewUrl ? (
                                <img src={previewUrl} alt="Preview" className="w-full h-full object-contain" />
                            ) : (
                                <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                    Select a PDF or image to preview
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: tabbed results */}
                    <div className="flex-1 p-4 border-l border-slate-200">
                        {/* Tab bar */}
                        <div className="flex items-center border-b border-slate-200 mb-3 gap-1">
                            {tabs.map(({ id, label }) => (
                                <button key={id} onClick={() => setActiveResultTab(id)}
                                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                                        activeResultTab === id
                                            ? 'border-sky-600 text-sky-600'
                                            : 'border-transparent text-slate-500 hover:text-slate-700'
                                    }`}>
                                    {label}
                                </button>
                            ))}
                            {multiPagePDF && (
                                <div className="ml-auto flex rounded-md overflow-hidden border border-slate-300 mb-1">
                                    <button onClick={() => setActiveHalf('left')}
                                        className={`px-3 py-1 text-xs ${activeHalf === 'left' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                                        Left
                                    </button>
                                    <button onClick={() => setActiveHalf('right')}
                                        className={`px-3 py-1 text-xs border-l border-slate-300 ${activeHalf === 'right' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                                        Right
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Tab: OCR Preview */}
                        {activeResultTab === 'preview' && (
                            <div ref={croppedImageContainerRef}
                                className="border border-slate-300 rounded-lg overflow-hidden bg-slate-50 w-full h-[660px]">
                                {previewImageSrc ? (
                                    <img src={previewImageSrc} alt="Preview" className="w-full h-full object-contain" />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                        Select a file to see preview
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab: Raw OCR JSON (tesseract only) */}
                        {activeResultTab === 'ocr-json' && (
                            <div className="relative h-[660px] overflow-auto border border-slate-200 rounded-lg bg-slate-50 p-3">
                                {activeData?.ocr_json ? (
                                    <>
                                        <div className="absolute top-2 right-2">
                                            <CopyButton text={JSON.stringify(activeData.ocr_json, null, 2)} />
                                        </div>
                                        <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap">
                                            {JSON.stringify(activeData.ocr_json, null, 2)}
                                        </pre>
                                    </>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                        Run OCR to see raw Tesseract output
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab: LLM Results */}
                        {activeResultTab === 'llm-results' && (
                            <div className="space-y-3 h-[660px] overflow-y-auto">
                                {results ? (
                                    renderBlockList(activeData?.blocks)
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                        Run LLM to see results
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab: Scan Config */}
                        {activeResultTab === 'scan-config' && (
                            <div className="relative h-[660px] overflow-auto border border-slate-200 rounded-lg bg-slate-50 p-3">
                                {scanConfig !== null ? (
                                    <>
                                        <div className="absolute top-2 right-2">
                                            <CopyButton text={JSON.stringify(scanConfig, null, 2)} />
                                        </div>
                                        <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap">
                                            {JSON.stringify(scanConfig, null, 2)}
                                        </pre>
                                    </>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                        Run processing to see scan config
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab: Paragraphs (tesseract only) */}
                        {activeResultTab === 'paragraphs' && (
                            <div className="space-y-3 h-[660px] overflow-y-auto">
                                {results ? (
                                    renderParagraphList(activeData?.paragraphs)
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                        Run OCR to see paragraph output
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer: batch download */}
                {isPDF && batchJobStatus === 'completed' && batchJobId && (
                    <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end">
                        <a href={`${API_BASE_URL}/eval/ocr/batch/download/${batchJobId}`}
                            download={batchZipFilename || 'extracted_text.zip'}
                            className="flex items-center gap-2 text-xs px-3 py-1.5 bg-slate-700 text-white rounded-md hover:bg-slate-800 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download ZIP
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PDFParser;
