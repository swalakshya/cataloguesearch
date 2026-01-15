import React, { useState, useRef, useEffect } from 'react';
import { Spinner } from './SharedComponents';
import ShowBookmarksButton from './ShowBookmarksButton';
import BookmarksModal from './BookmarksModal';
import ParsedBookmarksModal from './ParsedBookmarksModal';
import { addPageNumbersToBookmarks } from '../utils/pdfUtils';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';

const OCRUtils = ({ selectedFile: propSelectedFile, onFileSelect, basePaths, baseDirectoryHandles, onPdfParentDirChange }) => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [language, setLanguage] = useState('hin');
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
    const [parsedBookmarks, setParsedBookmarks] = useState({ extracted: [], ignored: [] });
    const [showParsedBookmarkModal, setShowParsedBookmarkModal] = useState(false);
    const [isParsedBookmarksLoading, setIsParsedBookmarksLoading] = useState(false);
    const [useGoogleOCR, setUseGoogleOCR] = useState(false);
    const [ocrMode, setOcrMode] = useState('psm6');
    const [bookmarkLLM, setBookmarkLLM] = useState('ollama');

    // New state for batch processing
    const [batchJobId, setBatchJobId] = useState(null);
    const [batchJobStatus, setBatchJobStatus] = useState(null);
    const [batchProgress, setBatchProgress] = useState(0);
    const [batchTotalPages, setBatchTotalPages] = useState(0);
    const [batchZipFilename, setBatchZipFilename] = useState(null);
    const [batchElapsedTime, setBatchElapsedTime] = useState(null);

    // New state for cropped image preview
    const [croppedPreviewUrl, setCroppedPreviewUrl] = useState(null);

    const fileInputRef = useRef(null);
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
        setParsedBookmarks({ extracted: [], ignored: [] });
        setShowParsedBookmarkModal(false);

        // Reset OCR state
        setOcrResults(null);
        setCroppedPreviewUrl(null);
        setError(null);
        setIsLoading(false);

        // Reset batch state
        resetBatchState();

        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleFileSelect = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Clear file browser selection when manual upload is used
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
        } catch (err) {
            setError(`Error rendering PDF page: ${err.message}`);
        }
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
            await renderPDFPage(pdfDoc, newPage);
            setOcrResults(null);
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
            formData.append('mode', ocrMode);

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
            // Convert OCR mode to PSM number for batch API
            const psmValue = ocrMode === 'psm3' ? 3 : 6;

            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('language', language);
            formData.append('use_google_ocr', useGoogleOCR);
            formData.append('psm', psmValue);

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

    const handleFetchParsedBookmarks = async () => {
        if (!selectedFile || !isPDF) {
            setError('Please select a PDF file to extract bookmarks.');
            return;
        }

        // Get the PDF path - need to construct full path for API call
        let pdfPath = '';
        const isFromBrowser = propSelectedFile && propSelectedFile.relativePath &&
                              selectedFile.name === propSelectedFile.selectedPDFFile;

        if (isFromBrowser && basePaths) {
            // Construct full path from base path + relative path
            pdfPath = `${basePaths.base_pdf_path}/${propSelectedFile.relativePath}.pdf`;
        } else {
            setError('PDF path not available. Please select a file from the browser.');
            return;
        }

        setIsParsedBookmarksLoading(true);
        setError(null);

        try {
            const response = await fetch(`${API_BASE_URL}/eval/bookmarks/extract`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    pdf_path: pdfPath,
                    llm_provider: bookmarkLLM
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || `HTTP error! status: ${response.status}`);
            }

            // Categorize bookmarks into extracted and ignored
            const extracted = [];
            const ignored = [];

            data.bookmarks.forEach(bookmark => {
                if (bookmark.pravachan_no || bookmark.date) {
                    extracted.push(bookmark);
                } else {
                    ignored.push(bookmark);
                }
            });

            setParsedBookmarks({ extracted, ignored });
            setShowParsedBookmarkModal(true);

        } catch (err) {
            setError(`Failed to fetch parsed bookmarks: ${err.message}`);
            console.error('Parsed Bookmarks Error:', err);
        } finally {
            setIsParsedBookmarksLoading(false);
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

            {/* Parsed Bookmarks Modal */}
            <ParsedBookmarksModal
                isOpen={showParsedBookmarkModal}
                onClose={() => setShowParsedBookmarkModal(false)}
                extractedBookmarks={parsedBookmarks.extracted}
                ignoredBookmarks={parsedBookmarks.ignored}
            />

            {/* Main OCR Utils Panel Container */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200" style={{ width: '130%', maxWidth: 'none' }}>
                {/* Header */}
                <div className="p-4 border-b border-slate-200">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">OCR Utils</h2>
                    <p className="text-slate-600">Extract text from images and PDF documents with OCR technology</p>
                </div>

                {/* Controls */}
                <div className="p-4 border-b border-slate-200 bg-slate-50">
                    <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {/* File Input */}
                        <div className="col-span-1 md:col-span-2 lg:col-span-3">
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                File Selection
                            </label>
                            <div className="space-y-2">
                                {/* File Upload Option */}
                                <div className="relative">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*,application/pdf"
                                        onChange={handleFileSelect}
                                        className="sr-only"
                                        id="file-upload"
                                    />
                                    <label
                                        htmlFor="file-upload"
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
                                        <div className="flex items-center">
                                            <svg className={`w-3 h-3 mr-1 ${
                                                selectedFile && selectedFile.name === propSelectedFile.selectedPDFFile 
                                                    ? 'text-green-600' 
                                                    : 'text-blue-600'
                                            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                {selectedFile && selectedFile.name === propSelectedFile.selectedPDFFile ? (
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                ) : (
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
                                                )}
                                            </svg>
                                            <span className={`font-medium truncate ${
                                                selectedFile && selectedFile.name === propSelectedFile.selectedPDFFile 
                                                    ? 'text-green-800' 
                                                    : 'text-blue-800'
                                            }`}>
                                                {selectedFile && selectedFile.name === propSelectedFile.selectedPDFFile 
                                                    ? 'Browser:' 
                                                    : 'Browser:'}
                                                {' '}
                                                {propSelectedFile.selectedPDFFile || 'Unknown'}
                                            </span>
                                        </div>
                                        {!(selectedFile && selectedFile.name === propSelectedFile.selectedPDFFile) && (
                                            <div className="text-xs text-blue-600">
                                                {baseDirectoryHandles?.pdf 
                                                    ? 'Loading...' 
                                                    : 'Need permissions'}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Language Selection */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Language
                            </label>
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

                        {/* OCR Mode Selection */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                OCR Mode
                            </label>
                            <select
                                value={ocrMode}
                                onChange={(e) => setOcrMode(e.target.value)}
                                className="block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-sky-500 focus:border-sky-500 text-sm"
                                title="OCR processing mode"
                            >
                                <option value="psm6">PSM 6 - Single Block</option>
                                <option value="psm3">PSM 3 - Auto Layout</option>
                                <option value="advanced">Advanced - Smart Paragraphs (beta)</option>
                            </select>
                        </div>

                        {/* Crop Controls */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Crop Top (%)
                            </label>
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
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Crop Bottom (%)
                            </label>
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
                            {/* Outline Toggle */}
                            <label className="flex items-center text-sm text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={showOutlines}
                                    onChange={(e) => setShowOutlines(e.target.checked)}
                                    className="mr-2 h-4 w-4 text-sky-600 focus:ring-sky-500 border-slate-300 rounded"
                                />
                                Show text outlines
                            </label>

                            {/* Google OCR Toggle */}
                            <label className="flex items-center text-sm text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={useGoogleOCR}
                                    onChange={(e) => setUseGoogleOCR(e.target.checked)}
                                    className="mr-2 h-4 w-4 text-sky-600 focus:ring-sky-500 border-slate-300 rounded"
                                />
                                Use Google OCR (₹0.13 per page)
                            </label>

                            {/* PDF Navigation */}
                            {isPDF && pdfDoc && (
                                <div className="flex items-center space-x-2 text-sm">
                                    <button
                                        onClick={() => handlePageNavigation('prev')}
                                        disabled={currentPage === 1}
                                        className="px-2 py-1 bg-slate-200 text-slate-700 rounded disabled:opacity-50 hover:bg-slate-300"
                                    >
                                        ←
                                    </button>
                                    <span className="text-slate-600">
                                        Page {currentPage} of {totalPages}
                                    </span>
                                    <button
                                        onClick={() => handlePageNavigation('next')}
                                        disabled={currentPage === totalPages}
                                        className="px-2 py-1 bg-slate-200 text-slate-700 rounded disabled:opacity-50 hover:bg-slate-300"
                                    >
                                        →
                                    </button>
                                </div>
                            )}

                            {/* Show bookmarks toggle */}
                            <ShowBookmarksButton
                                hasBookmarks={isPDF && bookmarks.length > 0}
                                onClick={() => setShowBookmarkModal(true)}
                            />

                            {/* Show parsed bookmarks button with LLM selector */}
                            {isPDF && selectedFile && propSelectedFile && propSelectedFile.relativePath && (
                                <div className="flex items-center space-x-2">
                                    <select
                                        value={bookmarkLLM}
                                        onChange={(e) => setBookmarkLLM(e.target.value)}
                                        className="text-sm border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        disabled={isParsedBookmarksLoading}
                                    >
                                        <option value="ollama">Ollama (Local)</option>
                                        <option value="groq">Groq</option>
                                        <option value="gemini">Gemini</option>
                                    </select>
                                    <button
                                        onClick={handleFetchParsedBookmarks}
                                        disabled={isParsedBookmarksLoading}
                                        className="text-sm text-purple-600 hover:text-purple-800 flex items-center disabled:text-gray-400 disabled:hover:text-gray-400"
                                    >
                                        {isParsedBookmarksLoading ? (
                                            <>
                                                <Spinner />
                                                <span className="ml-1">Loading...</span>
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                                </svg>
                                                Parse Bookmarks
                                            </>
                                        )}
                                    </button>
                                </div>
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
                            {isPDF && (
                                <button
                                    onClick={handleBatchOCRProcess}
                                    disabled={!selectedFile || isLoading}
                                    className="bg-green-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-green-700 transition duration-200 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center"
                                >
                                    {isLoading && batchJobId ? (
                                        <>
                                            <Spinner />
                                            <span className="ml-2">Processing PDF...</span>
                                        </>
                                    ) : (
                                        'Download Full PDF Text'
                                    )}
                                </button>
                            )}
                            <button
                                onClick={handleOCRProcess}
                                disabled={!selectedFile || isLoading}
                                className="bg-sky-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-sky-700 transition duration-200 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center"
                            >
                                {isLoading && !batchJobId ? (
                                    <>
                                        <Spinner />
                                        <span className="ml-2">Processing...</span>
                                    </>
                                ) : (
                                    'Run OCR on Current Page'
                                )}
                            </button>
                        </div>
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
                        {batchJobStatus === 'completed' && (
                             <a
                                href={`${API_BASE_URL}/eval/ocr/batch/download/${batchJobId}`}
                                download={batchZipFilename || 'extracted_text.zip'}
                                className="inline-block bg-sky-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-sky-700 transition duration-200"
                            >
                                Download Zip File
                            </a>
                        )}
                    </div>
                )}

                {/* Error Display */}
                {error && (
                    <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-red-800 text-sm">{error}</p>
                    </div>
                )}

                {/* Content Panels - Only show 2 panels at a time */}
                <div className="flex flex-col lg:flex-row">
                    {/* Image Preview Panel - Always shown */}
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

                    {/* Conditional Second Panel: Show OCR Results OR Cropped Preview */}
                    {ocrResults ? (
                        /* Results Panel - Show when OCR results exist */
                        <div className="flex-1 p-4 border-l border-slate-200">
                            <h3 className="text-lg font-semibold text-slate-800 mb-3">OCR Results</h3>
                            <div className="space-y-3 max-h-[700px] overflow-y-auto">
                                {ocrResults?.paragraphs?.length > 0 ? (
                                    ocrResults.paragraphs.map((paragraph, index) => (
                                        <div
                                            key={index}
                                            data-paragraph-index={index}
                                            onClick={() => handleParagraphClick(paragraph, index)}
                                            className="paragraph-item bg-slate-50 border border-slate-200 rounded-lg p-3 cursor-pointer hover:bg-slate-100 transition-colors relative"
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="text-xs text-slate-500 font-semibold">
                                                    Paragraph {index + 1}
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
                                            <div className="text-sm text-slate-800 whitespace-pre-wrap font-mono">
                                                {paragraph.text}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-8 text-slate-500">
                                        No text detected in the image.
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        /* Cropped Image Preview Panel - Show when no OCR results */
                        <div className="flex-1 p-4 border-l border-slate-200">
                            <h3 className="text-lg font-semibold text-slate-800 mb-3">
                                {croppedPreviewUrl ? 'Cropped Preview' : 'Cropped Preview / OCR Results'}
                            </h3>
                            <div 
                                ref={croppedImageContainerRef}
                                className="relative border border-slate-300 rounded-lg overflow-hidden bg-slate-50 w-full h-[700px]"
                            >
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
                                                <svg className="mx-auto h-12 w-12 text-slate-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                                <p className="text-slate-400 text-sm">Or run OCR to see extracted text results</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

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
