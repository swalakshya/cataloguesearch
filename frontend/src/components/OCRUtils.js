import React, { useState, useRef, useEffect } from 'react';
import { Spinner } from './SharedComponents';
import ShowBookmarksButton from './ShowBookmarksButton';
import BookmarksModal from './BookmarksModal';
import ParseBookmarksControl from './ParseBookmarksControl';
import { addPageNumbersToBookmarks } from '../utils/pdfUtils';
import FileOrUrlInput from './eval/FileOrUrlInput';

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

const PARAGRAPH_TYPE_STYLES = {
    STANDARD_PROSE: { label: 'Prose',       bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-800',   badge: 'bg-blue-100 text-blue-700' },
    VERSE_BLOCK:    { label: 'Verse',        bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-800',  badge: 'bg-amber-100 text-amber-700' },
    QA_BLOCK:       { label: 'Q&A',          bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800', badge: 'bg-purple-100 text-purple-700' },
};
const DEFAULT_PARAGRAPH_STYLE = { label: null, bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-800', badge: '' };

const OCRUtils = ({ selectedFile: propSelectedFile, onFileSelect, basePaths, baseDirectoryHandles, onPdfParentDirChange }) => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [language, setLanguage] = useState('hin');
    const [useDefaultScanConfig, setUseDefaultScanConfig] = useState(true);
    const [cropTop, setCropTop] = useState(0);
    const [cropBottom, setCropBottom] = useState(0);
    const [showOutlines, setShowOutlines] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [ocrResults, setOcrResults] = useState(null);
    const [error, setError] = useState(null);
    const [isPDF, setIsPDF] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [pdfDoc, setPdfDoc] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [bookmarks, setBookmarks] = useState([]);
    const [showBookmarkModal, setShowBookmarkModal] = useState(false);
    const [useGoogleOCR, setUseGoogleOCR] = useState(false);

    // New state for batch processing
    const [batchJobId, setBatchJobId] = useState(null);
    const [batchJobStatus, setBatchJobStatus] = useState(null);
    const [batchProgress, setBatchProgress] = useState(0);
    const [batchTotalPages, setBatchTotalPages] = useState(0);
    const [batchZipFilename, setBatchZipFilename] = useState(null);
    const [batchElapsedTime, setBatchElapsedTime] = useState(null);

    // New state for cropped image preview
    const [croppedPreviewUrl, setCroppedPreviewUrl] = useState(null);

    // Right-pane tab state
    const [activeResultTab, setActiveResultTab] = useState('preview');

    // Jump-to-page
    const [jumpPageNumber, setJumpPageNumber] = useState('');

    const imageContainerRef = useRef(null);
    const croppedImageContainerRef = useRef(null);
    const pollingIntervalRef = useRef(null);

    // PDF.js dynamic loading
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
                }
                catch (error) {
                    console.error('Failed to load PDF.js:', error);
                    setError('Failed to load PDF.js library. PDF functionality will not be available.');
                }
            }
            
            if (window.pdfjsLib) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }
        };

        loadPdfJs();

        // Cleanup polling on component unmount
        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, []);

    // Effect to handle file selection from file browser
    useEffect(() => {
        if (propSelectedFile && propSelectedFile.selectedPDFFile && 
            (!selectedFile || selectedFile.name !== propSelectedFile.selectedPDFFile)) {
            const handleBrowserFileSelection = async () => {
                try {
                    if (propSelectedFile.selectedPDFFile && baseDirectoryHandles?.pdf) {
                        // Reset all state to start fresh
                        resetAllState();
                        setIsLoading(true);
                        
                        // Navigate to the PDF file using the relative path
                        const pathParts = propSelectedFile.relativePath.split('/');
                        const pdfDirectory = pathParts.slice(0, -1).join('/'); // Remove the last part (PDF name without extension)

                        // Navigate to the PDF directory
                        let currentHandle = baseDirectoryHandles.pdf;
                        const pathSegments = pdfDirectory.split('/').filter(segment => segment.length > 0);

                        for (const segment of pathSegments) {
                            currentHandle = await currentHandle.getDirectoryHandle(segment);
                        }

                        // Notify parent component of the PDF parent directory path
                        if (onPdfParentDirChange) {
                            onPdfParentDirChange(pdfDirectory);
                        }

                        // Get the PDF file handle
                        const pdfFileHandle = await currentHandle.getFileHandle(propSelectedFile.selectedPDFFile);
                        const pdfFile = await pdfFileHandle.getFile();

                        // Set the selected file and load it
                        setSelectedFile(pdfFile);
                        setIsPDF(true);

                        // Load the PDF
                        await loadPDF(pdfFile);

                        setIsLoading(false);
                    } else if (propSelectedFile.selectedPDFFile) {
                        setError('Directory permissions not granted. Please grant permissions on the Home tab first.');
                    }
                } catch (err) {
                    setError(`Error loading file from browser: ${err.message}`);
                    setIsLoading(false);
                }
            };

            handleBrowserFileSelection();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propSelectedFile, baseDirectoryHandles]);

    const resetBatchState = () => {
        setBatchJobId(null);
        setBatchJobStatus(null);
        setBatchProgress(0);
        setBatchTotalPages(0);
        setBatchZipFilename(null);
        setBatchElapsedTime(null);
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
        }
    };

    const resetAllState = () => {
        // Reset file state
        setSelectedFile(null);
        setIsPDF(false);
        setPdfDoc(null);
        setPreviewUrl(null);
        setCurrentPage(1);
        setTotalPages(1);
        setBookmarks([]);
        setShowBookmarkModal(false);

        // Reset OCR state
        setOcrResults(null);
        setCroppedPreviewUrl(null);
        setError(null);
        setIsLoading(false);

        // Reset batch state
        resetBatchState();

    };

    const handleFileReady = async (file) => {
        // Clear file browser selection when a new file is provided
        if (onFileSelect) {
            onFileSelect(null);
        }

        // Reset all state to start fresh
        resetAllState();

        // Set the new file and load it
        setSelectedFile(file);
        const fileType = file.type;
        setIsPDF(fileType === 'application/pdf');

        if (fileType === 'application/pdf') {
            await loadPDF(file);
        } else {
            loadImagePreview(file);
        }
    };

    const loadImagePreview = (file) => {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
    };

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
                    // Add page numbers to all bookmarks
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
            console.error('PDF loading error:', err);
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

            const dataUrl = canvas.toDataURL('image/png');
            setPreviewUrl(dataUrl);
            return dataUrl;
        } catch (err) {
            setError(`Error rendering PDF page: ${err.message}`);
            return null;
        }
    };

    const applyCropToDataUrl = (dataUrl, cropTopPct, cropBottomPct) => {
        if (!dataUrl || (cropTopPct === 0 && cropBottomPct === 0)) {
            setCroppedPreviewUrl(null);
            return;
        }
        const img = new Image();
        img.onload = () => {
            const { width, height } = img;
            const topPx = Math.floor(height * cropTopPct / 100);
            const bottomPx = Math.floor(height * cropBottomPct / 100);
            const croppedHeight = height - topPx - bottomPx;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = croppedHeight;
            canvas.getContext('2d').drawImage(img, 0, topPx, width, croppedHeight, 0, 0, width, croppedHeight);
            setCroppedPreviewUrl(canvas.toDataURL('image/png'));
        };
        img.src = dataUrl;
    };

    const handlePageNavigation = async (direction) => {
        if (!pdfDoc) return;
        
        let newPage = currentPage;
        if (direction === 'prev' && currentPage > 1) {
            newPage = currentPage - 1;
        } else if (direction === 'next' && currentPage < totalPages) {
            newPage = currentPage + 1;
        }
        
        if (newPage !== currentPage) {
            setCurrentPage(newPage);
            const dataUrl = await renderPDFPage(pdfDoc, newPage);
            setOcrResults(null);
            applyCropToDataUrl(dataUrl, cropTop, cropBottom);
        }
    };

    const jumpToPage = async () => {
        const page = parseInt(jumpPageNumber, 10);
        if (!pdfDoc || isNaN(page) || page < 1 || page > totalPages || page === currentPage) return;
        setCurrentPage(page);
        const dataUrl = await renderPDFPage(pdfDoc, page);
        setOcrResults(null);
        applyCropToDataUrl(dataUrl, cropTop, cropBottom);
        setJumpPageNumber('');
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

    const handleOCRProcess = async () => {
        if (!selectedFile) {
            setError('Please select a file first');
            return;
        }

        setIsLoading(true);
        setError(null);
        setOcrResults(null);
        setCroppedPreviewUrl(null);
        resetBatchState();

        try {
            const formData = new FormData();
            formData.append('language', language);
            formData.append('crop_top', cropTop);
            formData.append('crop_bottom', cropBottom);
            formData.append('mode', 'advanced');

            // Check if file was selected from browser (PDF file system)
            const isFromBrowser = propSelectedFile && propSelectedFile.relativePath &&
                                  selectedFile.name === propSelectedFile.selectedPDFFile;

            if (isFromBrowser && isPDF) {
                // Mode 1: PDF extraction mode - send relative_path and page_number
                // Backend will extract the page directly from the PDF file
                formData.append('relative_path', propSelectedFile.relativePath);
                formData.append('page_number', currentPage);
                console.log(`Using PDF extraction mode: ${propSelectedFile.relativePath}, page ${currentPage}`);
            } else {
                // Mode 2: Upload mode - send image file
                let fileToProcess = selectedFile;

                if (isPDF) {
                    // Convert current PDF page to image
                    fileToProcess = await convertCurrentPageToImage();
                    if (!fileToProcess) {
                        throw new Error('Failed to convert PDF page to image');
                    }
                }

                formData.append('image', fileToProcess);
                formData.append('use_default_scan_config', useDefaultScanConfig);
                console.log(`Using upload mode with ${isPDF ? 'converted PDF page' : 'image file'}`);
            }

            const response = await fetch(`${API_BASE_URL}/eval/ocr`, {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || `HTTP error! status: ${response.status}`);
            }

            setOcrResults(data);
            setActiveResultTab('paragraphs');
        } catch (err) {
            setError(`OCR processing failed: ${err.message}`);
            console.error('OCR Error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleBatchOCRProcess = async () => {
        if (!selectedFile || !isPDF) {
            setError('Please select a PDF file for batch processing.');
            return;
        }

        // Check cost if Google OCR is enabled
        if (useGoogleOCR) {
            try {
                const costResponse = await fetch(`${API_BASE_URL}/eval/ocr/calculate-cost`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        total_pages: totalPages,
                        use_google_ocr: true
                    })
                });

                const costData = await costResponse.json();
                if (!costResponse.ok) {
                    throw new Error(costData.detail || 'Failed to calculate cost.');
                }

                const confirmMessage = `It'll cost ₹${costData.cost}. Continue?`;
                if (!window.confirm(confirmMessage)) {
                    return;
                }
            } catch (err) {
                setError(`Failed to calculate cost: ${err.message}`);
                return;
            }
        }

        setIsLoading(true);
        setError(null);
        setOcrResults(null);
        resetBatchState();

        try {
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('language', language);
            formData.append('use_google_ocr', useGoogleOCR);

            const response = await fetch(`${API_BASE_URL}/eval/ocr/batch`, {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Failed to start batch job.');
            }

            setBatchJobId(data.job_id);
            setBatchJobStatus(data.status || 'queued');

        } catch (err) {
            setError(`Failed to start batch OCR job: ${err.message}`);
            setIsLoading(false);
        }
    };

    const handleCancelBatchJob = async () => {
        if (!batchJobId) return;

        try {
            setBatchJobStatus('canceling');
            const response = await fetch(`${API_BASE_URL}/eval/ocr/batch/cancel/${batchJobId}`, {
                method: 'POST',
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to cancel job.');
            }

            // The polling will handle the final state change
        } catch (err) {
            setError(`Error canceling job: ${err.message}`);
        }
    };

    useEffect(() => {
        if (batchJobId && (batchJobStatus === 'queued' || batchJobStatus === 'preparing' || batchJobStatus === 'processing' || batchJobStatus === 'canceling')) {
            pollingIntervalRef.current = setInterval(async () => {
                try {
                    const response = await fetch(`${API_BASE_URL}/eval/ocr/batch/status/${batchJobId}`);
                    const data = await response.json();

                    if (!response.ok) {
                        throw new Error(data.detail || 'Failed to get job status.');
                    }

                    setBatchJobStatus(data.status);
                    setBatchProgress(data.progress);
                    setBatchTotalPages(data.total_pages);
                    setBatchElapsedTime(data.elapsed_time_formatted);

                    if (data.status === 'completed') {
                        setBatchZipFilename(data.zip_filename);
                    }

                    if (data.status === 'completed' || data.status === 'failed' || data.status === 'canceled') {
                        clearInterval(pollingIntervalRef.current);
                        setIsLoading(false);
                        if (data.status === 'failed') {
                            setError(`Batch processing failed: ${data.error}`);
                        }
                    }
                } catch (err) {
                    setError(`Error polling for job status: ${err.message}`);
                    clearInterval(pollingIntervalRef.current);
                    setIsLoading(false);
                }
            }, 3000);
        }

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, [batchJobId, batchJobStatus]);

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
                    
                    const croppedDataUrl = canvas.toDataURL('image/png');
                    setCroppedPreviewUrl(croppedDataUrl);
                    setOcrResults(null);
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

    const clearHighlights = () => {
        if (imageContainerRef.current) {
            const highlights = imageContainerRef.current.querySelectorAll('.highlight-box');
            highlights.forEach(highlight => highlight.remove());
        }
    };

    const addHighlights = (boxes, isParagraphSpecific = false) => {
        if (!imageContainerRef.current || !previewUrl) return;

        const img = imageContainerRef.current.querySelector('img');
        if (!img) return;

        const scaleX = img.clientWidth / img.naturalWidth;
        const scaleY = img.clientHeight / img.naturalHeight;

        boxes.forEach((box) => {
            const highlightDiv = document.createElement('div');
            highlightDiv.className = 'highlight-box';
            highlightDiv.style.position = 'absolute';
            highlightDiv.style.border = isParagraphSpecific ? '2px solid #28a745' : '2px solid blue';
            highlightDiv.style.backgroundColor = isParagraphSpecific ? 'rgba(40, 167, 69, 0.2)' : 'rgba(0, 0, 255, 0.1)';
            highlightDiv.style.pointerEvents = 'none';
            
            highlightDiv.style.left = (box.x * scaleX) + 'px';
            highlightDiv.style.top = (box.y * scaleY) + 'px';
            highlightDiv.style.width = (box.width * scaleX) + 'px';
            highlightDiv.style.height = (box.height * scaleY) + 'px';
            
            imageContainerRef.current.appendChild(highlightDiv);
        });
    };

    const updateHighlights = () => {
        clearHighlights();
        
        if (!ocrResults || !showOutlines) {
            return;
        }
        
        if (ocrResults.boxes && ocrResults.boxes.length > 0) {
            addHighlights(ocrResults.boxes);
        }
    };

    const handleParagraphClick = (paragraph, index) => {
        const paragraphElements = document.querySelectorAll('.paragraph-item');
        paragraphElements.forEach(el => el.classList.remove('active'));
        
        const clickedElement = document.querySelector(`[data-paragraph-index="${index}"]`);
        if (clickedElement) {
            clickedElement.classList.add('active');
        }
    };

    const handleCopyText = (text, event) => {
        event.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
            // Visual feedback could be added here
        }).catch(err => {
            console.error('Failed to copy text: ', err);
        });
    };

    useEffect(() => {
        updateHighlights();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showOutlines, ocrResults]);

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
                    setOcrResults(null);
                    setCroppedPreviewUrl(null);
                }
            }
        } catch (err) {
            console.error('Error navigating to bookmark:', err);
        }
    };

    const ProgressBar = ({ progress, total }) => {
        const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;
        return (
            <div className="w-full bg-slate-200 rounded-full h-2.5">
                <div 
                    className="bg-sky-600 h-2.5 rounded-full transition-all duration-500" 
                    style={{ width: `${percentage}%` }}
                ></div>
            </div>
        );
    };

    return (
        <div>
            {/* Bookmarks Modal */}
            <BookmarksModal
                isOpen={showBookmarkModal}
                onClose={() => setShowBookmarkModal(false)}
                bookmarks={bookmarks}
                onBookmarkClick={handleBookmarkClick}
            />

            {/* Main OCR Utils Panel Container */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200" style={{ width: '130%', maxWidth: 'none' }}>
                {/* Header */}
                <div className="p-4 border-b border-slate-200">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">OCR Utils</h2>
                    <p className="text-slate-600">Extract text from images and PDF documents with OCR technology</p>
                </div>

                {/* Controls */}
                <div className="px-4 pt-3 pb-2 border-b border-slate-200 bg-slate-50 space-y-2">

                    {/* Line 1: File input + Language */}
                    <div className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                            <FileOrUrlInput
                                onFileReady={handleFileReady}
                                selectedFile={selectedFile}
                                inputId="file-upload"
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
                        <div className="shrink-0">
                            <select
                                value={language}
                                onChange={(e) => setLanguage(e.target.value)}
                                className="text-sm px-2 py-1.5 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                            >
                                <option value="hin">हिंदी</option>
                                <option value="guj">ગુજરાતી</option>
                            </select>
                        </div>
                    </div>

                    {/* Line 2: Crop + scan config + Apply */}
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                            <label className="text-xs text-slate-500 whitespace-nowrap">Top %</label>
                            <input
                                type="number" step="0.1" min="0" max="50"
                                value={cropTop}
                                onChange={(e) => setCropTop(parseFloat(e.target.value) || 0)}
                                className="w-16 text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                            />
                        </div>
                        <div className="flex items-center gap-1">
                            <label className="text-xs text-slate-500 whitespace-nowrap">Bottom %</label>
                            <input
                                type="number" step="0.1" min="0" max="50"
                                value={cropBottom}
                                onChange={(e) => setCropBottom(parseFloat(e.target.value) || 0)}
                                className="w-16 text-xs px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                            />
                        </div>
                        {!propSelectedFile?.relativePath && (
                            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                                <input
                                    type="checkbox"
                                    id="use-default-scan-config"
                                    checked={useDefaultScanConfig}
                                    onChange={(e) => setUseDefaultScanConfig(e.target.checked)}
                                    className="h-3.5 w-3.5 text-sky-600 border-slate-300 rounded"
                                />
                                Default scan config
                            </label>
                        )}
                        <button
                            disabled={!selectedFile}
                            onClick={async () => {
                                if (cropTop > 0 || cropBottom > 0) {
                                    await handlePreviewCroppedImage();
                                } else {
                                    setCroppedPreviewUrl(null);
                                }
                                setActiveResultTab('preview');
                            }}
                            className="text-xs px-3 py-1.5 bg-slate-600 text-white rounded-md hover:bg-slate-700 transition duration-200 disabled:bg-slate-300 disabled:cursor-not-allowed"
                        >
                            Apply
                        </button>
                    </div>

                    {/* Line 3: Page nav + go-to + bookmarks + parse + Process */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {isPDF && pdfDoc && (
                                <>
                                    <button
                                        onClick={() => handlePageNavigation('prev')}
                                        disabled={currentPage === 1}
                                        className="px-2 py-1 text-xs bg-slate-200 text-slate-700 rounded disabled:opacity-40 hover:bg-slate-300"
                                    >←</button>
                                    <span className="text-xs text-slate-600">{currentPage} / {totalPages}</span>
                                    <button
                                        onClick={() => handlePageNavigation('next')}
                                        disabled={currentPage === totalPages}
                                        className="px-2 py-1 text-xs bg-slate-200 text-slate-700 rounded disabled:opacity-40 hover:bg-slate-300"
                                    >→</button>
                                    <input
                                        type="number"
                                        min="1"
                                        max={totalPages}
                                        value={jumpPageNumber}
                                        onChange={(e) => setJumpPageNumber(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && jumpToPage()}
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
                        </div>

                        <button
                            onClick={handleOCRProcess}
                            disabled={!selectedFile || isLoading}
                            className="text-xs px-3 py-1.5 bg-sky-600 text-white font-semibold rounded-md hover:bg-sky-700 transition duration-200 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-1"
                        >
                            {isLoading && !batchJobId ? <><Spinner /><span>Processing…</span></> : 'Process'}
                        </button>
                    </div>
                </div>

                {/* Batch Progress Bar */}
                {batchJobId && (
                    <div className="p-4 border-b border-slate-200">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-3">
                                <h3 className="text-sm font-medium text-slate-700">
                                    {batchJobStatus === 'queued' && 'Server at max limit, waiting for a slot to be freed....'}
                                    {batchJobStatus === 'preparing' && 'Preparing PDF for processing...'}
                                    {batchJobStatus === 'processing' && `Processing PDF... (${batchProgress} / ${batchTotalPages} pages)`}
                                    {batchJobStatus === 'canceling' && 'Canceling job...'}
                                    {batchJobStatus === 'canceled' && 'Job was canceled.'}
                                    {batchJobStatus === 'completed' && 'PDF processing complete!'}
                                    {batchJobStatus === 'failed' && 'PDF processing failed.'}
                                </h3>
                                {batchElapsedTime && (
                                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                                        {batchElapsedTime}
                                    </span>
                                )}
                            </div>
                            {(batchJobStatus === 'processing' || batchJobStatus === 'queued' || batchJobStatus === 'preparing') && (
                                <button
                                    onClick={handleCancelBatchJob}
                                    className="text-sm bg-red-500 text-white font-semibold py-1 px-3 rounded-md hover:bg-red-600 transition duration-200"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                        {(batchJobStatus === 'processing' || batchJobStatus === 'queued' || batchJobStatus === 'preparing') && (
                            <ProgressBar progress={batchProgress} total={batchTotalPages} />
                        )}
                    </div>
                )}

                {/* Error Display */}
                {error && (
                    <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-red-800 text-sm">{error}</p>
                    </div>
                )}

                {/* Content Panels */}
                <div className="flex flex-col lg:flex-row">
                    {/* Left: Image Preview - always shown */}
                    <div className="flex-1 p-4">
                        <h3 className="text-lg font-semibold text-slate-800 mb-3">Preview</h3>
                        <div
                            ref={imageContainerRef}
                            className="relative border border-slate-300 rounded-lg overflow-hidden bg-slate-50 w-full h-[700px]"
                        >
                            {previewUrl ? (
                                <img
                                    src={previewUrl}
                                    alt="Preview"
                                    className="w-full h-full object-contain"
                                    onLoad={updateHighlights}
                                />
                            ) : (
                                <div className="flex items-center justify-center h-full text-slate-500">
                                    <div className="text-center">
                                        <svg className="mx-auto h-12 w-12 text-slate-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                                            <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                        <p className="mt-2">Select an image or PDF file to preview</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Tabbed results panel */}
                    <div className="flex-1 p-4 border-l border-slate-200">
                        {/* Tab bar */}
                        <div className="flex border-b border-slate-200 mb-3 gap-1">
                            {[
                                { id: 'preview',    label: 'OCR Preview' },
                                { id: 'ocr-json',   label: 'Raw OCR JSON' },
                                { id: 'scan-config',label: 'Scan Config' },
                                { id: 'paragraphs', label: 'Paragraphs' },
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

                        {/* Tab: OCR Preview */}
                        {activeResultTab === 'preview' && (
                            <div
                                ref={croppedImageContainerRef}
                                className="relative border border-slate-300 rounded-lg overflow-hidden bg-slate-50 w-full h-[660px]"
                            >
                                {croppedPreviewUrl ? (
                                    <img src={croppedPreviewUrl} alt="Cropped Preview" className="w-full h-full object-contain" />
                                ) : previewUrl ? (
                                    <img src={previewUrl} alt="Preview" className="w-full h-full object-contain" />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                        Select a file to see preview
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab: Raw OCR JSON */}
                        {activeResultTab === 'ocr-json' && (
                            <div className="relative h-[660px] overflow-auto border border-slate-200 rounded-lg bg-slate-50 p-3">
                                {ocrResults?.ocr_json ? (
                                    <>
                                        <button
                                            onClick={(e) => handleCopyText(JSON.stringify(ocrResults.ocr_json, null, 2), e)}
                                            className="absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-colors"
                                            title="Copy JSON"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                        </button>
                                        <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap">
                                            {JSON.stringify(ocrResults.ocr_json, null, 2)}
                                        </pre>
                                    </>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                        Run OCR to see raw Tesseract output
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab: Scan Config */}
                        {activeResultTab === 'scan-config' && (
                            <div className="relative h-[660px] overflow-auto border border-slate-200 rounded-lg bg-slate-50 p-3">
                                {ocrResults ? (
                                    <>
                                        <button
                                            onClick={(e) => handleCopyText(JSON.stringify(ocrResults.scan_config ?? {}, null, 2), e)}
                                            className="absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-colors"
                                            title="Copy JSON"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                        </button>
                                        <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap">
                                            {JSON.stringify(ocrResults.scan_config ?? {}, null, 2)}
                                        </pre>
                                    </>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                        Run OCR to see effective scan config
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab: Paragraphs */}
                        {activeResultTab === 'paragraphs' && (
                            <div className="space-y-3 h-[660px] overflow-y-auto">
                                {ocrResults?.paragraphs?.length > 0 ? (
                                    ocrResults.paragraphs.map((paragraph, index) => {
                                        const style = PARAGRAPH_TYPE_STYLES[paragraph.paragraph_type] || DEFAULT_PARAGRAPH_STYLE;
                                        return (
                                            <div
                                                key={index}
                                                data-paragraph-index={index}
                                                onClick={() => handleParagraphClick(paragraph, index)}
                                                className={`paragraph-item ${style.bg} border ${style.border} rounded-lg p-3 cursor-pointer hover:opacity-80 transition-colors relative`}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-semibold ${style.text}`}>
                                                            Paragraph {index + 1}
                                                        </span>
                                                        {style.label && (
                                                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${style.badge}`}>
                                                                {style.label}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={(e) => handleCopyText(paragraph.text, e)}
                                                        className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-colors"
                                                        title="Copy paragraph text"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                        </svg>
                                                    </button>
                                                </div>
                                                <div className={`text-sm ${style.text} whitespace-pre-wrap font-mono`}>
                                                    {paragraph.text}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : ocrResults ? (
                                    <div className="text-center py-8 text-slate-500">No text detected in the image.</div>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                                        Run OCR to see paragraph output
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Download PDF footer */}
                {isPDF && batchJobStatus === 'completed' && batchJobId && (
                    <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end">
                        <a
                            href={`${API_BASE_URL}/eval/ocr/batch/download/${batchJobId}`}
                            download={batchZipFilename || 'extracted_text.zip'}
                            className="flex items-center gap-2 text-xs px-3 py-1.5 bg-slate-700 text-white rounded-md hover:bg-slate-800 transition duration-200"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download PDF
                        </a>
                    </div>
                )}

                <style>{`
                    .highlight-box {
                        transition: background-color 0.3s ease;
                    }
                    .paragraph-item.active {
                        background-color: #d1fae5 !important;
                        border-color: #a7f3d0 !important;
                    }
                `}</style>
            </div>
        </div>
    );
};

export default OCRUtils;
