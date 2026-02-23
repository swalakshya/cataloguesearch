import React, { useState, useRef, useEffect } from 'react';
import { Spinner } from '../SharedComponents';
import ShowBookmarksButton from '../ShowBookmarksButton';
import BookmarksModal from '../BookmarksModal';
import ParseBookmarksControl from '../ParseBookmarksControl';
import { addPageNumbersToBookmarks } from '../../utils/pdfUtils';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';

// Category display labels and colors
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
    // File state
    const [selectedFile, setSelectedFile] = useState(null);
    const [isPDF, setIsPDF] = useState(false);
    const [pdfDoc, setPdfDoc] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [previewUrl, setPreviewUrl] = useState(null);

    // Controls
    const [language, setLanguage] = useState('hin');
    const [modelName, setModelName] = useState('gemini-2.5-flash');
    const [cropTop, setCropTop] = useState(0);
    const [cropBottom, setCropBottom] = useState(0);

    // Bookmarks
    const [bookmarks, setBookmarks] = useState([]);
    const [showBookmarkModal, setShowBookmarkModal] = useState(false);

    // Cropped preview
    const [croppedPreviewUrl, setCroppedPreviewUrl] = useState(null);

    // Results
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [llmResults, setLlmResults] = useState(null); // { blocks, model, language, preview_image }

    const fileInputRef = useRef(null);

    // Load PDF.js
    useEffect(() => {
        const loadPdfJs = async () => {
            if (!window.pdfjsLib) {
                try {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                    script.async = true;
                    await new Promise((resolve, reject) => {
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                } catch (err) {
                    console.error('Failed to load PDF.js:', err);
                    setError('Failed to load PDF.js library.');
                }
            }
            if (window.pdfjsLib) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }
        };
        loadPdfJs();
    }, []);

    // Handle file selection from file browser (prop)
    useEffect(() => {
        if (propSelectedFile && propSelectedFile.selectedPDFFile &&
            (!selectedFile || selectedFile.name !== propSelectedFile.selectedPDFFile)) {
            const handleBrowserFileSelection = async () => {
                try {
                    if (propSelectedFile.selectedPDFFile && baseDirectoryHandles?.pdf) {
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
                        const fileHandle = await dirHandle.getFileHandle(actualFileName);
                        const file = await fileHandle.getFile();

                        setSelectedFile(file);
                        setIsPDF(true);
                        await loadPDF(file);
                        setIsLoading(false);
                    }
                } catch (err) {
                    console.error('Error loading file from browser:', err);
                    setError(`Failed to load file: ${err.message}`);
                    setIsLoading(false);
                }
            };
            handleBrowserFileSelection();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propSelectedFile, baseDirectoryHandles]);

    const loadPDF = async (file) => {
        if (!window.pdfjsLib) {
            setError('PDF.js library not loaded. Please refresh the page.');
            return;
        }
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument(arrayBuffer).promise;
            setPdfDoc(pdf);
            setTotalPages(pdf.numPages);
            setCurrentPage(1);

            try {
                const outline = await pdf.getOutline();
                if (outline && outline.length > 0) {
                    const bookmarksWithPages = await addPageNumbersToBookmarks(outline, pdf);
                    setBookmarks(bookmarksWithPages);
                } else {
                    setBookmarks([]);
                }
            } catch (outlineErr) {
                console.warn('Could not load PDF outline:', outlineErr);
                setBookmarks([]);
            }

            await renderPDFPage(pdf, 1);
        } catch (err) {
            setError(`Error loading PDF: ${err.message}`);
        }
    };

    const renderPDFPage = async (pdf, pageNum) => {
        try {
            const page = await pdf.getPage(pageNum);
            const scale = 1.5;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            setPreviewUrl(canvas.toDataURL('image/png'));
        } catch (err) {
            setError(`Error rendering PDF page: ${err.message}`);
        }
    };

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setError(null);
        setLlmResults(null);
        setSelectedFile(file);

        const isFilePDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        setIsPDF(isFilePDF);

        if (isFilePDF) {
            await loadPDF(file);
        } else {
            setPreviewUrl(URL.createObjectURL(file));
            setPdfDoc(null);
            setTotalPages(1);
            setCurrentPage(1);
        }
    };

    const handlePageNavigation = async (direction) => {
        if (!pdfDoc) return;
        let newPage = currentPage;
        if (direction === 'prev' && currentPage > 1) newPage = currentPage - 1;
        else if (direction === 'next' && currentPage < totalPages) newPage = currentPage + 1;

        if (newPage !== currentPage) {
            setCurrentPage(newPage);
            await renderPDFPage(pdfDoc, newPage);
            setLlmResults(null);
            setCroppedPreviewUrl(null);
        }
    };

    const convertCurrentPageToImage = async () => {
        if (!pdfDoc) return null;
        try {
            const page = await pdfDoc.getPage(currentPage);
            const scale = 1.5;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            return new Promise((resolve) => {
                canvas.toBlob((blob) => {
                    resolve(new File([blob], `page_${currentPage}.png`, { type: 'image/png' }));
                }, 'image/png');
            });
        } catch (err) {
            setError(`Error converting PDF page: ${err.message}`);
            return null;
        }
    };

    const handlePreviewCroppedImage = async () => {
        if (!selectedFile || (cropTop === 0 && cropBottom === 0)) return;

        setError(null);

        try {
            let imageSource = selectedFile;

            if (isPDF) {
                imageSource = await convertCurrentPageToImage();
                if (!imageSource) {
                    throw new Error('Failed to convert PDF page to image');
                }
            }

            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            return new Promise((resolve, reject) => {
                img.onload = () => {
                    const { width, height } = img;
                    const topCropPixels = Math.floor(height * cropTop / 100);
                    const bottomCropPixels = Math.floor(height * cropBottom / 100);
                    const croppedHeight = height - topCropPixels - bottomCropPixels;

                    canvas.width = width;
                    canvas.height = croppedHeight;
                    ctx.drawImage(img, 0, topCropPixels, width, croppedHeight, 0, 0, width, croppedHeight);

                    setCroppedPreviewUrl(canvas.toDataURL('image/png'));
                    setLlmResults(null);
                    resolve();
                };

                img.onerror = () => reject(new Error('Failed to load image'));

                if (isPDF) {
                    const reader = new FileReader();
                    reader.onload = (e) => img.src = e.target.result;
                    reader.readAsDataURL(imageSource);
                } else {
                    img.src = URL.createObjectURL(imageSource);
                }
            });
        } catch (err) {
            setError(`Failed to generate cropped preview: ${err.message}`);
        }
    };

    const handleRunLLM = async () => {
        if (!selectedFile) {
            setError('Please select a file first');
            return;
        }

        setIsLoading(true);
        setError(null);
        setLlmResults(null);
        setCroppedPreviewUrl(null);

        try {
            const formData = new FormData();
            formData.append('language', language);
            formData.append('model_name', modelName);
            formData.append('crop_top', cropTop);
            formData.append('crop_bottom', cropBottom);
            formData.append('page_number', currentPage);

            // Get the image to send
            let fileToProcess = selectedFile;
            if (isPDF) {
                fileToProcess = await convertCurrentPageToImage();
                if (!fileToProcess) {
                    throw new Error('Failed to convert PDF page to image');
                }
            }
            formData.append('image', fileToProcess);

            const response = await fetch(`${API_BASE_URL}/eval/scripture-llm`, {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || `HTTP error! status: ${response.status}`);
            }

            setLlmResults(data);
        } catch (err) {
            setError(`LLM processing failed: ${err.message}`);
            console.error('LLM Error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopyText = (text, e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
    };

    const handleBookmarkClick = async (bookmark) => {
        if (!pdfDoc || !bookmark.dest) return;
        try {
            let dest = bookmark.dest;
            if (typeof dest === 'string') {
                dest = await pdfDoc.getDestination(dest);
            }
            if (dest && dest.length > 0) {
                const pageRef = dest[0];
                const pageNumber = await pdfDoc.getPageIndex(pageRef) + 1;
                if (pageNumber !== currentPage) {
                    setCurrentPage(pageNumber);
                    await renderPDFPage(pdfDoc, pageNumber);
                    setLlmResults(null);
                }
            }
        } catch (err) {
            console.error('Error navigating to bookmark:', err);
        }
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
                <h2 className="text-2xl font-bold text-slate-800 mb-2">Scripture LLM Eval</h2>
                <p className="text-slate-600">Extract and categorise text from Jain scripture images using Gemini LLM</p>
            </div>

            {/* Controls */}
            <div className="p-4 border-b border-slate-200 bg-slate-50">
                <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {/* File Input */}
                    <div className="col-span-1 md:col-span-2 lg:col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            File Selection
                        </label>
                        <div className="space-y-2">
                            <div className="relative">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*,application/pdf"
                                    onChange={handleFileSelect}
                                    className="sr-only"
                                    id="scripture-llm-file-upload"
                                />
                                <label
                                    htmlFor="scripture-llm-file-upload"
                                    className="block w-full text-sm text-slate-500 border border-slate-300 rounded-md px-3 py-2 cursor-pointer bg-white hover:bg-slate-50 transition-colors"
                                >
                                    <span className="inline-flex items-center">
                                        <span className="bg-sky-50 text-sky-700 font-semibold px-2 py-1 rounded-md mr-2 hover:bg-sky-100 text-xs">
                                            Upload
                                        </span>
                                        <span className="text-slate-500 text-xs truncate">
                                            {selectedFile ? selectedFile.name : 'No file selected'}
                                        </span>
                                    </span>
                                </label>
                            </div>

                            {/* File Browser Info */}
                            {propSelectedFile && (
                                <div className={`p-1 border rounded-md text-xs ${
                                    selectedFile && selectedFile.name === propSelectedFile.selectedPDFFile
                                        ? 'bg-green-50 border-green-200'
                                        : 'bg-blue-50 border-blue-200'
                                }`}>
                                    <span className={`font-medium ${
                                        selectedFile && selectedFile.name === propSelectedFile.selectedPDFFile
                                            ? 'text-green-800' : 'text-blue-800'
                                    }`}>
                                        Browser: {propSelectedFile.selectedPDFFile || 'Unknown'}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Language Selection */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Language</label>
                        <select
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                            className="block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                        >
                            <option value="hin">Hindi</option>
                            <option value="guj">Gujarati</option>
                            <option value="eng">English</option>
                        </select>
                    </div>

                    {/* LLM Model Selection */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">LLM Model</label>
                        <select
                            value={modelName}
                            onChange={(e) => setModelName(e.target.value)}
                            className="block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-sky-500 focus:border-sky-500 text-sm"
                        >
                            <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        </select>
                    </div>

                    {/* Crop Controls */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Crop Top (%)</label>
                        <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="50"
                            value={cropTop}
                            onChange={(e) => setCropTop(parseFloat(e.target.value) || 0)}
                            className="block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Crop Bottom (%)</label>
                        <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="50"
                            value={cropBottom}
                            onChange={(e) => setCropBottom(parseFloat(e.target.value) || 0)}
                            className="block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                        />
                    </div>
                </div>

                {/* Additional Controls */}
                <div className="flex items-center justify-between mt-4">
                    <div className="flex items-center space-x-4">
                        {/* PDF Navigation */}
                        {isPDF && pdfDoc && (
                            <div className="flex items-center space-x-2 text-sm">
                                <button
                                    onClick={() => handlePageNavigation('prev')}
                                    disabled={currentPage === 1}
                                    className="px-2 py-1 bg-slate-200 text-slate-700 rounded disabled:opacity-50 hover:bg-slate-300"
                                >
                                    &larr;
                                </button>
                                <span className="text-slate-600">
                                    Page {currentPage} of {totalPages}
                                </span>
                                <button
                                    onClick={() => handlePageNavigation('next')}
                                    disabled={currentPage === totalPages}
                                    className="px-2 py-1 bg-slate-200 text-slate-700 rounded disabled:opacity-50 hover:bg-slate-300"
                                >
                                    &rarr;
                                </button>
                            </div>
                        )}

                        {/* Show Bookmarks */}
                        <ShowBookmarksButton
                            hasBookmarks={isPDF && bookmarks.length > 0}
                            onClick={() => setShowBookmarkModal(true)}
                        />

                        {/* Parse Bookmarks control with LLM selector */}
                        <ParseBookmarksControl
                            isPDF={isPDF}
                            pdfDoc={pdfDoc}
                        />

                        {/* Model info */}
                        {llmResults && (
                            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                                Model: {llmResults.model} | {llmResults.blocks.length} blocks
                            </span>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center space-x-2">
                        {(cropTop > 0 || cropBottom > 0) && selectedFile && (
                            <button
                                onClick={handlePreviewCroppedImage}
                                disabled={isLoading}
                                className="bg-orange-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-orange-700 transition duration-200 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center"
                            >
                                Preview Cropped Image
                            </button>
                        )}
                        <button
                            onClick={handleRunLLM}
                            disabled={!selectedFile || isLoading}
                            className="bg-sky-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-sky-700 transition duration-200 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center"
                        >
                            {isLoading ? (
                                <>
                                    <Spinner />
                                    <span className="ml-2">Processing...</span>
                                </>
                            ) : (
                                'Run LLM on Current Page'
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-red-800 text-sm">{error}</p>
                </div>
            )}

            {/* Content Panels */}
            <div className="flex flex-col lg:flex-row">
                {/* Preview Panel */}
                <div className="flex-1 p-4">
                    <h3 className="text-lg font-semibold text-slate-800 mb-3">
                        {llmResults ? 'Cropped Preview' : 'Preview'}
                    </h3>
                    <div className="relative border border-slate-300 rounded-lg overflow-hidden bg-slate-50 w-full h-[700px]">
                        {llmResults?.preview_image ? (
                            <img
                                src={`data:image/png;base64,${llmResults.preview_image}`}
                                alt="Cropped Preview"
                                className="w-full h-full object-contain"
                            />
                        ) : previewUrl ? (
                            <img
                                src={previewUrl}
                                alt="Preview"
                                className="w-full h-full object-contain"
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full text-slate-500">
                                <div className="text-center">
                                    <svg className="mx-auto h-12 w-12 text-slate-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                                        <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    <p className="mt-2">Select a PDF or image file to preview</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Conditional Second Panel: Show LLM Results OR Cropped Preview */}
                {llmResults ? (
                    /* LLM Results Panel */
                    <div className="flex-1 p-4 border-l border-slate-200">
                        <h3 className="text-lg font-semibold text-slate-800 mb-3">LLM Results</h3>
                        <div className="space-y-3 max-h-[700px] overflow-y-auto">
                            {llmResults.blocks?.length > 0 ? (
                                llmResults.blocks.map((block, index) => {
                                    const style = CATEGORY_STYLES[block.type] || DEFAULT_STYLE;
                                    return (
                                        <div
                                            key={index}
                                            className={`${style.bg} border ${style.border} rounded-lg p-3 relative`}
                                        >
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
                            ) : (
                                <div className="text-center py-8 text-slate-500">
                                    No text detected in the image.
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    /* Cropped Preview Panel - Show when no LLM results */
                    <div className="flex-1 p-4 border-l border-slate-200">
                        <h3 className="text-lg font-semibold text-slate-800 mb-3">
                            {croppedPreviewUrl ? 'Cropped Preview' : 'Cropped Preview / LLM Results'}
                        </h3>
                        <div className="relative border border-slate-300 rounded-lg overflow-hidden bg-slate-50 w-full h-[700px]">
                            {croppedPreviewUrl ? (
                                <img
                                    src={croppedPreviewUrl}
                                    alt="Cropped Preview"
                                    className="w-full h-full object-contain"
                                />
                            ) : (
                                <div className="flex items-center justify-center h-full text-slate-500">
                                    <div className="text-center">
                                        <svg className="mx-auto h-12 w-12 text-slate-400 mb-3" stroke="currentColor" fill="none" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <p className="mt-2 mb-4">
                                            {(cropTop > 0 || cropBottom > 0) && selectedFile
                                                ? 'Click "Preview Cropped Image" to see cropped version'
                                                : 'Set crop values and select a file to preview cropped image'
                                            }
                                        </p>
                                        <div className="border-t border-slate-300 pt-4">
                                            <p className="text-slate-400 text-sm">Or run LLM to see extracted text results</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
        </div>
    );
};

export default ScriptureLLMEval;