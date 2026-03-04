import React, { useState, useEffect } from 'react';
import { Spinner } from '../SharedComponents';
import ShowBookmarksButton from '../ShowBookmarksButton';
import BookmarksModal from '../BookmarksModal';
import ParseBookmarksControl from '../ParseBookmarksControl';
import FileOrUrlInput from './FileOrUrlInput';
import usePDFViewer from '../../hooks/usePDFViewer';

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

const CATEGORY_STYLES = {
    chapter_heading: { label: 'Chapter Heading', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800', badge: 'bg-purple-100 text-purple-700' },
    sanskrit_text:   { label: 'Sanskrit Text',   bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', badge: 'bg-orange-100 text-orange-700' },
    sanskrit_verse:  { label: 'Sanskrit Verse',  bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-800',  badge: 'bg-amber-100 text-amber-700' },
    prakrit_text:    { label: 'Prakrit Text',    bg: 'bg-teal-50',   border: 'border-teal-200',   text: 'text-teal-800',   badge: 'bg-teal-100 text-teal-700' },
    prakrit_verse:   { label: 'Prakrit Verse',   bg: 'bg-cyan-50',   border: 'border-cyan-200',   text: 'text-cyan-800',   badge: 'bg-cyan-100 text-cyan-700' },
    hindi_text:      { label: 'Hindi Text',      bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-800',   badge: 'bg-blue-100 text-blue-700' },
    hindi_verse:     { label: 'Hindi Verse',     bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-800', badge: 'bg-indigo-100 text-indigo-700' },
    footnote:        { label: 'Footnote',        bg: 'bg-slate-50',  border: 'border-slate-300',  text: 'text-slate-700',  badge: 'bg-slate-200 text-slate-600' },
};
const DEFAULT_STYLE = { label: 'Unknown', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-800', badge: 'bg-gray-100 text-gray-700' };

const ScriptureLLMEval = ({ selectedFile: propSelectedFile, baseDirectoryHandles, basePaths }) => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [isPDF, setIsPDF] = useState(false);
    const [language, setLanguage] = useState('hin');
    const [modelName, setModelName] = useState('gemini-2.5-flash');
    const [cropTop, setCropTop] = useState(0);
    const [cropBottom, setCropBottom] = useState(0);
    const [useDefaultScanConfig, setUseDefaultScanConfig] = useState(true);
    const [jumpPageNumber, setJumpPageNumber] = useState('');
    const [showBookmarkModal, setShowBookmarkModal] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [llmResults, setLlmResults] = useState(null);
    const [activeResultTab, setActiveResultTab] = useState('preview');

    const pdfViewer = usePDFViewer({ setError });
    const { pdfDoc, currentPage, totalPages, previewUrl, croppedPreviewUrl, bookmarks } = pdfViewer;

    // Handle file selection from file browser (prop)
    useEffect(() => {
        if (propSelectedFile && propSelectedFile.selectedPDFFile &&
            (!selectedFile || selectedFile.name !== propSelectedFile.selectedPDFFile)) {
            const load = async () => {
                try {
                    if (baseDirectoryHandles?.pdf) {
                        setIsLoading(true);
                        setError(null);
                        setLlmResults(null);
                        const pathParts = propSelectedFile.relativePath.split('/');
                        let dirHandle = baseDirectoryHandles.pdf;
                        for (let i = 0; i < pathParts.length - 1; i++) {
                            dirHandle = await dirHandle.getDirectoryHandle(pathParts[i]);
                        }
                        const pdfFileName = pathParts[pathParts.length - 1];
                        const actualFileName = pdfFileName.endsWith('.pdf') ? pdfFileName : `${pdfFileName}.pdf`;
                        const file = await (await dirHandle.getFileHandle(actualFileName)).getFile();
                        setSelectedFile(file);
                        setIsPDF(true);
                        await pdfViewer.loadPDF(file);
                        setIsLoading(false);
                    }
                } catch (err) {
                    setError(`Failed to load file: ${err.message}`);
                    setIsLoading(false);
                }
            };
            load();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propSelectedFile, baseDirectoryHandles]);

    const handleFileReady = async (file) => {
        setError(null);
        setLlmResults(null);
        setSelectedFile(file);
        const isFilePDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        setIsPDF(isFilePDF);
        if (isFilePDF) {
            await pdfViewer.loadPDF(file);
        } else {
            pdfViewer.loadImagePreview(file);
        }
    };

    const handlePageNavigation = (direction) => {
        pdfViewer.handlePageNavigation(direction, cropTop, cropBottom, () => setLlmResults(null));
    };

    const handleJumpToPage = async () => {
        await pdfViewer.jumpToPage(jumpPageNumber, cropTop, cropBottom, () => setLlmResults(null));
        setJumpPageNumber('');
    };

    const handleApply = () => {
        if (!selectedFile) return;
        pdfViewer.applyCropToDataUrl(previewUrl, cropTop, cropBottom);
        setLlmResults(null);
        setActiveResultTab('preview');
    };

    const handleBookmarkClick = (bookmark) => {
        pdfViewer.navigateToBookmark(bookmark, () => setLlmResults(null));
    };

    const convertCurrentPageToImage = async () => {
        if (!pdfDoc) return null;
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
    };

    const handleRunLLM = async () => {
        if (!selectedFile) { setError('Please select a file first'); return; }
        setIsLoading(true);
        setError(null);
        setLlmResults(null);
        try {
            const formData = new FormData();
            formData.append('language', language);
            formData.append('model_name', modelName);
            formData.append('crop_top', cropTop);
            formData.append('crop_bottom', cropBottom);
            formData.append('page_number', currentPage);
            formData.append('use_default_scan_config', useDefaultScanConfig);

            let fileToProcess = selectedFile;
            if (isPDF) {
                fileToProcess = await convertCurrentPageToImage();
                if (!fileToProcess) throw new Error('Failed to convert PDF page to image');
            }
            formData.append('image', fileToProcess);

            const response = await fetch(`${API_BASE_URL}/eval/scripture-llm`, { method: 'POST', body: formData });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || `HTTP error! status: ${response.status}`);
            setLlmResults(data);
            setActiveResultTab('llm-results');
        } catch (err) {
            setError(`LLM processing failed: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopyText = (text, e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
    };

    return (
        <div>
            <BookmarksModal
                isOpen={showBookmarkModal}
                onClose={() => setShowBookmarkModal(false)}
                bookmarks={bookmarks}
                onBookmarkClick={handleBookmarkClick}
            />

            <div className="bg-white rounded-lg shadow-sm border border-slate-200" style={{ width: '130%', maxWidth: 'none' }}>
                {/* Header */}
                <div className="p-4 border-b border-slate-200">
                    <h2 className="text-2xl font-bold text-slate-800 mb-1">Scripture LLM Eval</h2>
                    <p className="text-slate-600 text-sm">Extract and categorise text from Jain scripture pages using Gemini LLM</p>
                </div>

                {/* Controls */}
                <div className="px-4 pt-3 pb-2 border-b border-slate-200 bg-slate-50 space-y-2">

                    {/* Line 1: File input (with embedded language toggle) */}
                    <div>
                        <FileOrUrlInput
                            onFileReady={handleFileReady}
                            selectedFile={selectedFile}
                            inputId="scripture-llm-file-upload"
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

                    {/* Line 2: Crop + Model + Default scan_config + Apply */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-xs text-slate-500 shrink-0">Top %</label>
                        <input
                            type="number" step="0.1" min="0" max="50"
                            value={cropTop}
                            onChange={(e) => setCropTop(parseFloat(e.target.value) || 0)}
                            className="w-16 text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                        />
                        <label className="text-xs text-slate-500 shrink-0">Bottom %</label>
                        <input
                            type="number" step="0.1" min="0" max="50"
                            value={cropBottom}
                            onChange={(e) => setCropBottom(parseFloat(e.target.value) || 0)}
                            className="w-16 text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                        />
                        <select
                            value={modelName}
                            onChange={(e) => setModelName(e.target.value)}
                            className="text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                        >
                            <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        </select>
                        <label className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer shrink-0">
                            <input
                                type="checkbox"
                                checked={useDefaultScanConfig}
                                onChange={(e) => setUseDefaultScanConfig(e.target.checked)}
                                className="rounded"
                            />
                            Default scan config
                        </label>
                        <button
                            onClick={handleApply}
                            disabled={!selectedFile}
                            className="text-xs px-2 py-1 bg-slate-600 text-white rounded-md hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                        >
                            Apply
                        </button>
                    </div>

                    {/* Line 3: Page nav + jump + bookmarks + Process */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {isPDF && pdfDoc && (
                            <>
                                <button onClick={() => handlePageNavigation('prev')} disabled={currentPage === 1}
                                    className="px-2 py-1 text-xs bg-slate-200 text-slate-700 rounded disabled:opacity-40 hover:bg-slate-300">←</button>
                                <span className="text-xs text-slate-600">{currentPage} / {totalPages}</span>
                                <button onClick={() => handlePageNavigation('next')} disabled={currentPage === totalPages}
                                    className="px-2 py-1 text-xs bg-slate-200 text-slate-700 rounded disabled:opacity-40 hover:bg-slate-300">→</button>
                                <input
                                    type="number" min="1" max={totalPages}
                                    value={jumpPageNumber}
                                    onChange={(e) => setJumpPageNumber(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleJumpToPage()}
                                    placeholder="Go to"
                                    className="w-16 text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                                />
                            </>
                        )}
                        <ShowBookmarksButton
                            hasBookmarks={isPDF && bookmarks.length > 0}
                            onClick={() => setShowBookmarkModal(true)}
                        />
                        <ParseBookmarksControl isPDF={isPDF} pdfDoc={pdfDoc} />
                        <div className="ml-auto">
                            <button
                                onClick={handleRunLLM}
                                disabled={!selectedFile || isLoading}
                                className="text-xs px-3 py-1.5 bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
                            >
                                {isLoading ? <><Spinner /><span>Processing…</span></> : 'Process'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-red-800 text-sm">{error}</p>
                    </div>
                )}

                {/* Content Panels */}
                <div className="flex flex-col lg:flex-row">
                    {/* Left: full-page preview */}
                    <div className="flex-1 p-4">
                        <h3 className="text-base font-semibold text-slate-700 mb-2">Preview</h3>
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

                    {/* Right: tabbed */}
                    <div className="flex-1 p-4 border-l border-slate-200">
                        {/* Tab bar */}
                        <div className="flex border-b border-slate-200 mb-3">
                            {[
                                { id: 'preview',     label: 'OCR Preview' },
                                { id: 'llm-results', label: 'LLM Results' },
                                { id: 'scan-config', label: 'Scan Config' },
                            ].map(({ id, label }) => (
                                <button
                                    key={id}
                                    onClick={() => setActiveResultTab(id)}
                                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                                        activeResultTab === id
                                            ? 'border-sky-600 text-sky-600'
                                            : 'border-transparent text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Tab: OCR Preview (cropped) */}
                        {activeResultTab === 'preview' && (
                            <div className="border border-slate-300 rounded-lg overflow-hidden bg-slate-50 w-full h-[660px]">
                                {croppedPreviewUrl || llmResults?.preview_image ? (
                                    <img
                                        src={croppedPreviewUrl || `data:image/png;base64,${llmResults.preview_image}`}
                                        alt="Cropped Preview"
                                        className="w-full h-full object-contain"
                                    />
                                ) : previewUrl ? (
                                    <img src={previewUrl} alt="Preview" className="w-full h-full object-contain" />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                        Apply crop values to see preview
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab: LLM Results */}
                        {activeResultTab === 'llm-results' && (
                            <div className="space-y-3 h-[660px] overflow-y-auto">
                                {llmResults?.blocks?.length > 0 ? (
                                    llmResults.blocks.map((block, index) => {
                                        const style = CATEGORY_STYLES[block.type] || DEFAULT_STYLE;
                                        return (
                                            <div key={index} className={`${style.bg} border ${style.border} rounded-lg p-3`}>
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${style.badge}`}>
                                                        {style.label}
                                                    </span>
                                                    <button
                                                        onClick={(e) => handleCopyText(block.text, e)}
                                                        className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-colors"
                                                        title="Copy text"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                        </svg>
                                                    </button>
                                                </div>
                                                <div className={`text-sm ${style.text} whitespace-pre-wrap font-mono`}>
                                                    {block.text}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : llmResults ? (
                                    <div className="text-center py-8 text-slate-500">No text detected.</div>
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
                                {llmResults ? (
                                    <>
                                        <button
                                            onClick={(e) => handleCopyText(JSON.stringify(llmResults.scan_config ?? {}, null, 2), e)}
                                            className="absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-colors"
                                            title="Copy JSON"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                        </button>
                                        <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap">
                                            {JSON.stringify(llmResults.scan_config ?? {}, null, 2)}
                                        </pre>
                                    </>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                        Run LLM to see effective scan config
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ScriptureLLMEval;
