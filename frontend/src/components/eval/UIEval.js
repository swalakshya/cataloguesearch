import React, { useState, useEffect } from 'react';
import OCRUtils from '../OCRUtils';
import ParagraphGenEval from './ParagraphGenEval';
import ScriptureEval from './ScriptureEval';
import OCRPreview from './OCRPreview';
import FileBrowser from './FileBrowser';
import { storeDirectoryHandles, getStoredDirectoryHandles, validateDirectoryHandles } from '../../utils/directoryHandlers';

const UIEval = () => {
    const [activeTab, setActiveTab] = useState('home');
    const [basePaths, setBasePaths] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [showFileBrowser, setShowFileBrowser] = useState(false);
    const [selectedFolder, setSelectedFolder] = useState(null);
    const [baseDirectoryHandles, setBaseDirectoryHandles] = useState(null);
    const [pdfParentDirPath, setPdfParentDirPath] = useState('');

    // Debug activeTab changes
    useEffect(() => {
        console.log('activeTab changed to:', activeTab);
    }, [activeTab]);

    // Load base paths from API
    useEffect(() => {
        const loadBasePaths = async () => {
            try {
                const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';
                const response = await fetch(`${API_BASE_URL}/eval/paths`);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    throw new Error('Response is not JSON - backend server may not be running or eval routes not loaded');
                }
                const data = await response.json();
                setBasePaths(data);
            } catch (err) {
                console.error('Failed to load configuration:', err);
                // For development, you can add fallback paths here
                console.warn('Using fallback configuration - please restart the backend server to load eval routes');
                setBasePaths({
                    base_pdf_path: '/path/to/pdf',
                    base_ocr_path: '/path/to/ocr', 
                    base_text_path: '/path/to/text'
                });
            }
        };
        loadBasePaths();
    }, []);

    // Load stored directory handles on component mount
    useEffect(() => {
        const loadStoredHandles = async () => {
            try {
                const storedHandles = await getStoredDirectoryHandles();
                if (storedHandles.pdf && storedHandles.ocr && storedHandles.text) {
                    // Validate that the handles still have permissions
                    const isValid = await validateDirectoryHandles(storedHandles);
                    if (isValid) {
                        setBaseDirectoryHandles(storedHandles);
                        console.log('Successfully restored directory handles from storage');
                    } else {
                        console.log('Stored directory handles lost permissions');
                    }
                }
            } catch (err) {
                console.log('Error loading stored directory handles:', err);
            }
        };

        loadStoredHandles();
    }, []);

    const handleBrowseFiles = () => {
        setShowFileBrowser(true);
    };

    const handleCloseFileBrowser = () => {
        setShowFileBrowser(false);
    };

    const handleFileSelect = (file) => {
        setSelectedFile(file);
        setShowFileBrowser(false);
    };

    const handleFolderSelect = (folderSelection) => {
        setSelectedFolder(folderSelection);
        
        // Set selected file for different file types
        if (folderSelection && (folderSelection.selectedPDFFile || folderSelection.fileType === 'markdown')) {
            setSelectedFile(folderSelection);
            if (folderSelection.selectedPDFFile) {
                console.log('PDF file selected for OCR:', folderSelection.selectedPDFFile);
            } else if (folderSelection.fileType === 'markdown') {
                console.log('Markdown file selected for Scripture Eval:', folderSelection.selectedFileName);
            }
        }
        
        setShowFileBrowser(false);
        console.log('Folder selected:', folderSelection);
    };

    const handleBaseDirectoryHandlesChange = (handles) => {
        setBaseDirectoryHandles(handles);
    };

    const requestBaseDirectoryPermissions = async () => {
        if (!basePaths) return;
        
        try {
            // Check if File System Access API is available
            if (!window.showDirectoryPicker) {
                alert('File System Access API is not supported in this browser. Please use Google Chrome for the best experience.');
                return;
            }
            
            // Request PDF directory
            const pdfHandle = await window.showDirectoryPicker();
            
            // Request OCR directory
            const ocrHandle = await window.showDirectoryPicker();
            
            // Request Text directory
            const textHandle = await window.showDirectoryPicker();
            
            // Store all handles
            const handles = {
                pdf: pdfHandle,
                ocr: ocrHandle,
                text: textHandle
            };
            setBaseDirectoryHandles(handles);
            
            // Store in IndexedDB for persistence
            try {
                await storeDirectoryHandles(handles);
                console.log('Directory handles stored successfully');
            } catch (storageErr) {
                console.warn('Could not persist directory handles:', storageErr);
            }
            
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('User cancelled directory selection');
            } else {
                console.error('Error requesting directory permissions:', err);
                alert(`Error accessing directories: ${err.message}`);
            }
        }
    };


    const NavButton = ({ id, label, isActive, onClick }) => (
        <button
            onClick={(e) => {
                console.log('NavButton clicked:', id, 'Current activeTab:', activeTab);
                e.preventDefault();
                e.stopPropagation();
                onClick(id);
                console.log('After onClick, activeTab should be:', id);
            }}
            onMouseDown={(e) => {
                console.log('NavButton mousedown:', id);
            }}
            className={`px-4 py-2 font-medium text-sm rounded-md transition-colors ${
                isActive 
                    ? 'bg-sky-600 text-white' 
                    : 'text-slate-700 hover:bg-slate-100 border border-slate-300'
            }`}
            style={{ pointerEvents: 'auto', zIndex: 1 }}
        >
            {label}
        </button>
    );

    return (
        <div className="min-h-screen bg-slate-50">
            {/* File Browser Modal */}
            {showFileBrowser && (
                <FileBrowser
                    isOpen={showFileBrowser}
                    onClose={handleCloseFileBrowser}
                    onFolderSelect={handleFolderSelect}
                    basePaths={basePaths}
                    baseDirectoryHandles={baseDirectoryHandles}
                    currentTab={activeTab}
                    startPath={pdfParentDirPath}
                />
            )}
            
            <div className="container mx-auto p-4 md:p-5">
                <div className="max-w-[1200px] mx-auto">
                    {/* Header */}
                    <div className="mb-6">
                        <h1 className="text-3xl font-bold text-slate-800 mb-2">Manual Evaluation UI</h1>
                        <p className="text-slate-600">Tools for manual evaluation of OCR and paragraph generation</p>
                    </div>

                    {/* Navigation Bar */}
                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 mb-6">
                        <div className="p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex space-x-2">
                                    <NavButton
                                        id="home"
                                        label="Home"
                                        isActive={activeTab === 'home'}
                                        onClick={setActiveTab}
                                    />
                                    <NavButton
                                        id="ocr-eval"
                                        label="OCR Eval"
                                        isActive={activeTab === 'ocr-eval'}
                                        onClick={setActiveTab}
                                    />
                                    <NavButton
                                        id="ocr-preview"
                                        label="OCR Preview"
                                        isActive={activeTab === 'ocr-preview'}
                                        onClick={setActiveTab}
                                    />
                                    <NavButton
                                        id="paragraph-eval"
                                        label="Paragraph Gen Eval"
                                        isActive={activeTab === 'paragraph-eval'}
                                        onClick={setActiveTab}
                                    />
                                    <NavButton
                                        id="scripture-eval"
                                        label="Scripture Eval"
                                        isActive={activeTab === 'scripture-eval'}
                                        onClick={setActiveTab}
                                    />
                                </div>

                                {/* File Browser Button */}
                                {(activeTab === 'ocr-eval' || activeTab === 'ocr-preview' || activeTab === 'paragraph-eval' || activeTab === 'scripture-eval') && (
                                    <button
                                        onClick={handleBrowseFiles}
                                        className="bg-green-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-green-700 transition-colors flex items-center"
                                    >
                                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
                                        </svg>
                                        Browse Files
                                    </button>
                                )}
                            </div>

                            {/* Base Paths Info */}
                            {basePaths && activeTab !== 'home' && (
                                <div className="mt-4 pt-4 border-t border-slate-200">
                                    <div className="text-sm text-slate-600">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div>
                                                <span className="font-medium">Base PDF:</span>
                                                <div className="font-mono text-xs text-slate-500 mt-1 break-all">
                                                    {basePaths.base_pdf_path}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="font-medium">OCR Path:</span>
                                                <div className="font-mono text-xs text-slate-500 mt-1 break-all">
                                                    {basePaths.base_ocr_path}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="font-medium">Text Path:</span>
                                                <div className="font-mono text-xs text-slate-500 mt-1 break-all">
                                                    {basePaths.base_text_path}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="mb-6">
                        {activeTab === 'home' && (
                            <div className="space-y-6">
                                {/* Directory Permissions Setup */}
                                {basePaths && (
                                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                                        <div className="mb-4">
                                            <h3 className="text-lg font-semibold text-slate-800 mb-2">Directory Permissions</h3>
                                            <p className="text-slate-600 text-sm">
                                                Grant access to your base directories to enable file browsing across all evaluation tools.
                                            </p>
                                        </div>

                                        {!baseDirectoryHandles ? (
                                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                                                <div className="flex items-start">
                                                    <svg className="w-5 h-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                                    </svg>
                                                    <div>
                                                        <p className="text-amber-800 font-medium text-sm">Directory access required</p>
                                                        <p className="text-amber-700 text-sm mt-1">
                                                            Please grant permission to access your base directories to use file browsing features in the evaluation tools.
                                                        </p>
                                                        <button
                                                            onClick={requestBaseDirectoryPermissions}
                                                            className="mt-3 bg-amber-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-amber-700 transition duration-200"
                                                        >
                                                            Grant Directory Permissions
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                                                <div className="flex items-start">
                                                    <svg className="w-5 h-5 text-green-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    <div>
                                                        <p className="text-green-800 font-medium text-sm">Directory permissions granted</p>
                                                        <p className="text-green-700 text-sm mt-1">
                                                            File browsing is now available across all evaluation tools.
                                                        </p>
                                                        <div className="mt-2 text-xs text-green-600">
                                                            <div>📁 PDF Directory: {basePaths.base_pdf_path}</div>
                                                            <div>📁 OCR Directory: {basePaths.base_ocr_path}</div>
                                                            <div>📁 Text Directory: {basePaths.base_text_path}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Evaluation Tools */}
                                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8">
                                    <div className="text-center max-w-2xl mx-auto">
                                        <div className="mb-6">
                                            <svg className="mx-auto h-16 w-16 text-sky-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                            <h2 className="text-2xl font-bold text-slate-800 mb-4">Manual Evaluation Tools</h2>
                                            <p className="text-slate-600 mb-6">
                                                Choose an evaluation tool to get started with manual assessment of your data processing pipeline.
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 hover:bg-slate-100 transition-colors cursor-pointer"
                                                 onClick={() => setActiveTab('ocr-eval')}>
                                                <div className="text-sky-600 mb-3">
                                                    <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                    </svg>
                                                </div>
                                                <h3 className="text-lg font-semibold text-slate-800 mb-2">OCR Evaluation</h3>
                                                <p className="text-sm text-slate-600">
                                                    Test and evaluate OCR accuracy on individual files. Extract text from images and PDFs with configurable settings.
                                                </p>
                                            </div>

                                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 hover:bg-slate-100 transition-colors cursor-pointer"
                                                 onClick={() => setActiveTab('paragraph-eval')}>
                                                <div className="text-green-600 mb-3">
                                                    <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                                    </svg>
                                                </div>
                                                <h3 className="text-lg font-semibold text-slate-800 mb-2">Paragraph Generation Eval</h3>
                                                <p className="text-sm text-slate-600">
                                                    Compare paragraph generation outputs between different directories. Side-by-side comparison of source and target text files.
                                                </p>
                                            </div>
                                        </div>

                                    {basePaths && (
                                        <div className="mt-8 p-4 bg-sky-50 border border-sky-200 rounded-lg">
                                            <h4 className="font-semibold text-sky-800 mb-2">Configuration Loaded</h4>
                                            <p className="text-sm text-sky-700">
                                                Base paths have been loaded from the server configuration. You can now use the evaluation tools with your configured directories.
                                            </p>
                                        </div>
                                    )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'ocr-eval' && (
                            <OCRUtils
                                selectedFile={selectedFile}
                                onFileSelect={handleFileSelect}
                                basePaths={basePaths}
                                baseDirectoryHandles={baseDirectoryHandles}
                                onPdfParentDirChange={(dirPath) => {
                                    console.log('PDF parent directory changed to:', dirPath);
                                    setPdfParentDirPath(dirPath);
                                }}
                            />
                        )}

                        {activeTab === 'paragraph-eval' && basePaths && (
                            <ParagraphGenEval
                                showFileBrowser={showFileBrowser}
                                onCloseFileBrowser={handleCloseFileBrowser}
                                basePaths={basePaths}
                                selectedFolder={selectedFolder}
                                baseDirectoryHandles={baseDirectoryHandles}
                                onPdfParentDirChange={(dirPath) => {
                                    console.log('PDF parent directory changed to:', dirPath);
                                    setPdfParentDirPath(dirPath);
                                }}
                            />
                        )}

                        {activeTab === 'ocr-preview' && (
                            <OCRPreview
                                selectedFile={selectedFile}
                                baseDirectoryHandles={baseDirectoryHandles}
                            />
                        )}

                        {activeTab === 'scripture-eval' && basePaths && (
                            <ScriptureEval
                                selectedFile={selectedFile}
                                onFileSelect={handleFileSelect}
                                basePaths={basePaths}
                                baseDirectoryHandles={baseDirectoryHandles}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UIEval;