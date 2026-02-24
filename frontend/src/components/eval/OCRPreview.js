import React, { useState, useEffect } from 'react';
import { Spinner } from '../SharedComponents';

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

const OCRPreview = ({ selectedFile: propSelectedFile, baseDirectoryHandles }) => {
    const [pdfFile, setPdfFile] = useState(null);
    const [pdfFileName, setPdfFileName] = useState('');
    const [cropTop, setCropTop] = useState(0);
    const [cropBottom, setCropBottom] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [previewPages, setPreviewPages] = useState([]);
    const [currentOffset, setCurrentOffset] = useState(0);
    const [pagesPerView, setPagesPerView] = useState(50);
    const [totalPages, setTotalPages] = useState(0);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [selectedPageForComparison, setSelectedPageForComparison] = useState(null);
    const [originalImage, setOriginalImage] = useState(null);
    const [isLoadingOriginal, setIsLoadingOriginal] = useState(false);

    // Effect to handle file selection from FileBrowser
    useEffect(() => {
        if (propSelectedFile && propSelectedFile.selectedPDFFile) {
            const loadPDFFile = async () => {
                try {
                    setError(null);

                    console.log('propSelectedFile received:', propSelectedFile);

                    // Check if we have the file handle
                    if (!propSelectedFile.pdfFileHandle) {
                        throw new Error('No file handle received from FileBrowser');
                    }

                    // Use the file handle directly from FileBrowser
                    const file = await propSelectedFile.pdfFileHandle.getFile();

                    console.log('PDF file loaded successfully:', {
                        name: file.name,
                        size: file.size,
                        type: file.type
                    });

                    setPdfFile(file);
                    setPdfFileName(propSelectedFile.selectedPDFFile);

                    // Reset preview state when new file is selected
                    setPreviewPages([]);
                    setCurrentOffset(0);
                    setTotalPages(0);
                } catch (err) {
                    console.error('Error loading PDF file:', err);
                    setError(`Failed to load PDF file: ${err.message}`);
                }
            };

            loadPDFFile();
        }
    }, [propSelectedFile]);

    const handlePreview = async (offsetOverride = null) => {
        if (!pdfFile) {
            setError('Please select a PDF file first using the Browse Files button');
            return;
        }

        if (!(0 <= cropTop && cropTop <= 50 && 0 <= cropBottom && cropBottom <= 50)) {
            setError('Crop percentages must be between 0 and 50');
            return;
        }

        const offset = offsetOverride !== null ? offsetOverride : currentOffset;

        setIsLoading(true);
        setError(null);

        try {
            console.log('Starting preview generation with:', {
                fileName: pdfFile.name,
                fileSize: pdfFile.size,
                fileType: pdfFile.type,
                cropTop,
                cropBottom,
                offset: offset,
                limit: pagesPerView,
                offsetType: typeof offset,
                limitType: typeof pagesPerView
            });

            const formData = new FormData();
            formData.append('pdf_file', pdfFile);
            formData.append('crop_top', String(cropTop));
            formData.append('crop_bottom', String(cropBottom));
            formData.append('offset', String(offset));
            formData.append('limit', String(pagesPerView));

            console.log('FormData values being sent:', {
                crop_top: String(cropTop),
                crop_bottom: String(cropBottom),
                offset: String(offset),
                limit: String(pagesPerView)
            });

            const response = await fetch(`${API_BASE_URL}/eval/ocr-preview`, {
                method: 'POST',
                body: formData,
            });

            console.log('API response status:', response.status);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
                console.error('API error response:', errorData);

                // Handle array of errors (FastAPI validation errors)
                let errorMessage;
                if (Array.isArray(errorData.detail)) {
                    errorMessage = errorData.detail.map(err => `${err.loc?.join('.')}: ${err.msg}`).join(', ');
                } else {
                    errorMessage = errorData.detail || `HTTP ${response.status}: Preview generation failed`;
                }

                throw new Error(errorMessage);
            }

            const data = await response.json();
            console.log('Preview generated successfully:', {
                pageCount: data.pages.length,
                totalPages: data.total_pages
            });

            setPreviewPages(data.pages);
            setTotalPages(data.total_pages);
        } catch (err) {
            console.error('Preview error:', err);
            setError(err.message || 'Failed to generate preview');
        } finally {
            setIsLoading(false);
        }
    };

    const handlePrevious = () => {
        const newOffset = Math.max(0, currentOffset - pagesPerView);
        setCurrentOffset(newOffset);
        // Automatically trigger preview with new offset
        if (pdfFile) {
            handlePreview(newOffset);
        }
    };

    const handleNext = () => {
        const newOffset = currentOffset + pagesPerView;
        if (newOffset < totalPages) {
            setCurrentOffset(newOffset);
            // Automatically trigger preview with new offset
            if (pdfFile) {
                handlePreview(newOffset);
            }
        }
    };

    const handlePagesPerViewChange = (event) => {
        const newValue = parseInt(event.target.value);
        setPagesPerView(newValue);
        setCurrentOffset(0); // Reset to first page when changing page count
    };

    const handleZoomIn = () => {
        setZoomLevel(prev => Math.min(prev + 0.2, 3)); // Max 3x zoom
    };

    const handleZoomOut = () => {
        setZoomLevel(prev => Math.max(prev - 0.2, 0.4)); // Min 0.4x zoom
    };

    const handleResetZoom = () => {
        setZoomLevel(1);
    };

    const handlePageClick = async (page) => {
        if (!pdfFile) return;

        setSelectedPageForComparison(page);
        setShowModal(true);
        setIsLoadingOriginal(true);
        setOriginalImage(null);

        try {
            console.log('Fetching original image for page:', page.page_number);

            // Fetch the original (uncropped) version of this page
            const formData = new FormData();
            formData.append('pdf_file', pdfFile);
            formData.append('crop_top', '0');
            formData.append('crop_bottom', '0');
            formData.append('offset', String(page.page_number - 1)); // Convert to 0-indexed
            formData.append('limit', '10'); // Minimum allowed by backend

            console.log('Fetching with params:', {
                fileName: pdfFile.name,
                crop_top: 0,
                crop_bottom: 0,
                offset: page.page_number - 1,
                limit: 10
            });

            const response = await fetch(`${API_BASE_URL}/eval/ocr-preview`, {
                method: 'POST',
                body: formData,
            });

            console.log('Original image response status:', response.status);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
                console.error('Error response:', errorData);
                throw new Error(errorData.detail || 'Failed to fetch original image');
            }

            const data = await response.json();
            console.log('Original image data received:', {
                pageCount: data.pages?.length,
                totalPages: data.total_pages,
                firstPage: data.pages?.[0]?.page_number
            });

            if (data.pages && data.pages.length > 0) {
                setOriginalImage(data.pages[0].image_data);
                console.log('Original image set successfully');
            } else {
                console.error('No pages in response');
                throw new Error('No image data received');
            }
        } catch (err) {
            console.error('Error fetching original image:', err);
            // Keep the error in state so we can show it in the modal
        } finally {
            setIsLoadingOriginal(false);
        }
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setSelectedPageForComparison(null);
        setOriginalImage(null);
    };

    // Generate page count options (10, 20, 30, ..., 100)
    const pageCountOptions = [];
    for (let i = 10; i <= 100; i += 10) {
        pageCountOptions.push(i);
    }

    return (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-800 mb-2">OCR Preview</h2>
                <p className="text-slate-600">
                    Preview PDF pages with cropping applied to visualize OCR preprocessing
                </p>
            </div>

            {/* Selected File Info */}
            {pdfFile ? (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-md">
                    <div className="flex items-start">
                        <svg className="w-5 h-5 text-green-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <p className="text-green-800 font-medium text-sm">PDF File Selected</p>
                            <p className="text-green-700 text-sm mt-1">
                                <span className="font-medium">{pdfFileName}</span>
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
                    <div className="flex items-start">
                        <svg className="w-5 h-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <p className="text-blue-800 font-medium text-sm">No PDF Selected</p>
                            <p className="text-blue-700 text-sm mt-1">
                                Click the "Browse Files" button in the navigation bar to select a PDF file
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Crop Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        Crop Top (%)
                    </label>
                    <input
                        type="number"
                        step="0.1"
                        value={cropTop}
                        onChange={(e) => setCropTop(parseFloat(e.target.value) || 0)}
                        min="0"
                        max="50"
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        Crop Bottom (%)
                    </label>
                    <input
                        type="number"
                        step="0.1"
                        value={cropBottom}
                        onChange={(e) => setCropBottom(parseFloat(e.target.value) || 0)}
                        min="0"
                        max="50"
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>
            </div>

            {/* Preview Button */}
            <div className="mb-6">
                <button
                    onClick={() => handlePreview()}
                    disabled={!pdfFile || isLoading}
                    className="bg-green-600 text-white font-semibold py-2 px-6 rounded-md hover:bg-green-700 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed"
                >
                    {isLoading ? 'Generating Preview...' : 'Preview'}
                </button>
            </div>

            {/* Error Message */}
            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-red-800">{error}</p>
                </div>
            )}

            {/* Loading Spinner */}
            {isLoading && (
                <div className="flex justify-center items-center py-12">
                    <Spinner />
                </div>
            )}

            {/* Preview Controls */}
            {previewPages.length > 0 && (
                <>
                    <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-md">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
                            {/* Navigation Controls */}
                            <div className="flex items-center space-x-3">
                                <button
                                    onClick={handlePrevious}
                                    disabled={currentOffset === 0}
                                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center"
                                >
                                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                    </svg>
                                    Previous
                                </button>
                                <span className="text-sm text-slate-600">
                                    Pages {currentOffset + 1} - {Math.min(currentOffset + pagesPerView, totalPages)} of {totalPages}
                                </span>
                                <button
                                    onClick={handleNext}
                                    disabled={currentOffset + pagesPerView >= totalPages}
                                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center"
                                >
                                    Next
                                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                            </div>

                            {/* Pages Per View Selector */}
                            <div className="flex items-center space-x-2">
                                <label className="text-sm font-medium text-slate-700">
                                    Pages per view:
                                </label>
                                <select
                                    value={pagesPerView}
                                    onChange={handlePagesPerViewChange}
                                    className="px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    {pageCountOptions.map(count => (
                                        <option key={count} value={count}>{count}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Zoom Controls */}
                            <div className="flex items-center space-x-2">
                                <button
                                    onClick={handleZoomOut}
                                    className="bg-slate-600 text-white px-3 py-2 rounded-md hover:bg-slate-700 transition-colors"
                                    title="Zoom Out"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
                                    </svg>
                                </button>
                                <span className="text-sm font-medium text-slate-700 min-w-[60px] text-center">
                                    {Math.round(zoomLevel * 100)}%
                                </span>
                                <button
                                    onClick={handleResetZoom}
                                    className="bg-slate-600 text-white px-3 py-2 rounded-md hover:bg-slate-700 transition-colors text-xs"
                                    title="Reset Zoom"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={handleZoomIn}
                                    className="bg-slate-600 text-white px-3 py-2 rounded-md hover:bg-slate-700 transition-colors"
                                    title="Zoom In"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Preview Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {previewPages.map((page) => (
                            <div
                                key={page.page_number}
                                className="border border-slate-300 rounded-lg overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                                onClick={() => handlePageClick(page)}
                            >
                                <div className="relative">
                                    <img
                                        src={`data:image/png;base64,${page.image_data}`}
                                        alt={`Page ${page.page_number}`}
                                        className="w-full h-auto"
                                        style={{
                                            transform: `scale(${zoomLevel})`,
                                            transformOrigin: 'top left',
                                            width: `${100 / zoomLevel}%`,
                                        }}
                                    />
                                    <div className="absolute top-2 left-2 bg-blue-600 text-white px-2 py-1 rounded text-xs font-semibold">
                                        Page {page.page_number}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Comparison Modal */}
            {showModal && selectedPageForComparison && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={handleCloseModal}>
                    <div className="bg-white rounded-lg shadow-xl max-w-7xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
                        {/* Modal Header */}
                        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
                            <h3 className="text-xl font-bold text-slate-800">
                                Page {selectedPageForComparison.page_number} - Comparison
                            </h3>
                            <button
                                onClick={handleCloseModal}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Original Image */}
                                <div className="border border-slate-300 rounded-lg overflow-hidden">
                                    <div className="bg-slate-100 px-4 py-2 border-b border-slate-300">
                                        <h4 className="font-semibold text-slate-700">Original (No Cropping)</h4>
                                    </div>
                                    <div className="p-4 bg-slate-50">
                                        {isLoadingOriginal ? (
                                            <div className="flex justify-center items-center py-20">
                                                <Spinner />
                                            </div>
                                        ) : originalImage ? (
                                            <img
                                                src={`data:image/png;base64,${originalImage}`}
                                                alt={`Original Page ${selectedPageForComparison.page_number}`}
                                                className="w-full h-auto"
                                            />
                                        ) : (
                                            <div className="text-center py-20 text-slate-500">
                                                Failed to load original image
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Cropped Preview Image */}
                                <div className="border border-slate-300 rounded-lg overflow-hidden">
                                    <div className="bg-blue-100 px-4 py-2 border-b border-blue-300">
                                        <h4 className="font-semibold text-blue-700">
                                            Preview (Top: {cropTop}%, Bottom: {cropBottom}%)
                                        </h4>
                                    </div>
                                    <div className="p-4 bg-blue-50">
                                        <img
                                            src={`data:image/png;base64,${selectedPageForComparison.image_data}`}
                                            alt={`Preview Page ${selectedPageForComparison.page_number}`}
                                            className="w-full h-auto"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-6 py-4 flex justify-end">
                            <button
                                onClick={handleCloseModal}
                                className="bg-slate-600 text-white px-6 py-2 rounded-md hover:bg-slate-700 transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OCRPreview;
