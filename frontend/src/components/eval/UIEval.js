import React, { useState, useEffect } from 'react';
import PDFParser from './PDFParser';
import ParagraphGenEval from './ParagraphGenEval';
import OCRPreview from './OCRPreview';
import FileBrowser from './FileBrowser';
import ParaClassifier from './ParaClassifier';
import { storeDirectoryHandles, getStoredDirectoryHandles, validateDirectoryHandles, requestStoredPermissions, clearStoredDirectoryHandles } from '../../utils/directoryHandlers';

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

const UIEval = () => {
    const [activeTab, setActiveTab] = useState('home');
    const [basePaths, setBasePaths] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [showFileBrowser, setShowFileBrowser] = useState(false);
    const [selectedFolder, setSelectedFolder] = useState(null);
    const [baseDirectoryHandles, setBaseDirectoryHandles] = useState(null);
    const [expiredHandles, setExpiredHandles] = useState(null); // stored but permissions lapsed
    const [pendingHandles, setPendingHandles] = useState({ pdf: null, ocr: null, text: null });
    const [pdfParentDirPath, setPdfParentDirPath] = useState('');

    // Debug activeTab changes
    useEffect(() => {
        console.log('activeTab changed to:', activeTab);
    }, [activeTab]);

    // Load base paths from API
    useEffect(() => {
        const loadBasePaths = async () => {
            try {
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
                    const isValid = await validateDirectoryHandles(storedHandles);
                    if (isValid) {
                        setBaseDirectoryHandles(storedHandles);
                        console.log('Successfully restored directory handles from storage');
                    } else {
                        // Permissions lapsed — keep handles so we can re-grant without navigation
                        setExpiredHandles(storedHandles);
                        console.log('Stored handles found but permissions lapsed — re-grant available');
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

    const resetPermissions = async () => {
        await clearStoredDirectoryHandles();
        setBaseDirectoryHandles(null);
        setExpiredHandles(null);
    };

    const regrantPermissions = async () => {
        if (!expiredHandles) return;
        try {
            const granted = await requestStoredPermissions(expiredHandles);
            if (granted) {
                setBaseDirectoryHandles(expiredHandles);
                setExpiredHandles(null);
            } else {
                alert('Permission was denied. Please try again or use "Set up from scratch".');
            }
        } catch (err) {
            console.error('Error re-granting permissions:', err);
        }
    };

    const pickerActiveRef = React.useRef(false);

    const pickDirectory = async (key) => {
        if (pickerActiveRef.current) return;
        if (!window.showDirectoryPicker) {
            alert('File System Access API is not supported in this browser. Please use Google Chrome for the best experience.');
            return;
        }
        pickerActiveRef.current = true;
        try {
            const handle = await window.showDirectoryPicker();
            setPendingHandles(prev => ({ ...prev, [key]: handle }));
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Error picking directory:', err);
            }
        } finally {
            pickerActiveRef.current = false;
        }
    };

    const confirmDirectories = async () => {
        const handles = { ...pendingHandles };
        setBaseDirectoryHandles(handles);
        setExpiredHandles(null);
        setPendingHandles({ pdf: null, ocr: null, text: null });
        try {
            await storeDirectoryHandles(handles);
            console.log('Directory handles stored successfully');
        } catch (storageErr) {
            console.warn('Could not persist directory handles:', storageErr);
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
                                        id="pdf-parser"
                                        label="PDF Parser"
                                        isActive={activeTab === 'pdf-parser'}
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
                                        id="paragraph-classifier"
                                        label="Paragraph Classifier"
                                        isActive={activeTab === 'paragraph-classifier'}
                                        onClick={setActiveTab}
                                    />
                                </div>

                                {/* File Browser Button */}
                                {(activeTab === 'pdf-parser' || activeTab === 'ocr-preview' || activeTab === 'paragraph-eval' || activeTab === 'paragraph-classifier') && (
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

                                        {baseDirectoryHandles ? (
                                            // State 1 — all good
                                            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                                                <div className="flex items-start">
                                                    <svg className="w-5 h-5 text-green-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    <div>
                                                        <p className="text-green-800 font-medium text-sm">Directory permissions granted</p>
                                                        <p className="text-green-700 text-sm mt-1">File browsing is available across all evaluation tools.</p>
                                                        <div className="mt-2 text-xs text-green-600 space-y-0.5">
                                                            <div>📁 Configs & PDFs: {baseDirectoryHandles.pdf?.name}</div>
                                                            <div>📁 OCR Output: {baseDirectoryHandles.ocr?.name}</div>
                                                            <div>📁 Text Output: {baseDirectoryHandles.text?.name}</div>
                                                        </div>
                                                        <button
                                                            onClick={resetPermissions}
                                                            className="mt-3 text-green-700 text-xs underline hover:text-green-900"
                                                        >
                                                            Reset &amp; start over
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : expiredHandles ? (
                                            // State 2 — had permissions before, just need re-grant (no navigation)
                                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                                                <div className="flex items-start">
                                                    <svg className="w-5 h-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                                    </svg>
                                                    <div className="flex-1">
                                                        <p className="text-amber-800 font-medium text-sm">Permissions expired</p>
                                                        <p className="text-amber-700 text-sm mt-1">
                                                            Your previously selected folders are remembered. Click Re-grant — the browser will show Allow dialogs, no folder navigation needed.
                                                        </p>
                                                        <div className="mt-2 text-xs text-amber-700 space-y-0.5">
                                                            <div>📁 Configs & PDFs: <span className="font-mono">{expiredHandles.pdf?.name}</span></div>
                                                            <div>📁 OCR Output: <span className="font-mono">{expiredHandles.ocr?.name}</span></div>
                                                            <div>📁 Text Output: <span className="font-mono">{expiredHandles.text?.name}</span></div>
                                                        </div>
                                                        <div className="mt-3 flex items-center gap-3">
                                                            <button
                                                                onClick={regrantPermissions}
                                                                className="bg-amber-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-amber-700 transition duration-200"
                                                            >
                                                                Re-grant Access
                                                            </button>
                                                            <button
                                                                onClick={resetPermissions}
                                                                className="text-amber-700 text-sm underline hover:text-amber-900"
                                                            >
                                                                Set up from scratch
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            // State 3 — first time, pick each directory independently
                                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                                                <div className="flex items-start">
                                                    <svg className="w-5 h-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                                    </svg>
                                                    <div className="flex-1">
                                                        <p className="text-amber-800 font-medium text-sm">Directory access required</p>
                                                        <p className="text-amber-700 text-sm mt-1">
                                                            Select each directory individually, then click Confirm.
                                                        </p>
                                                        <div className="mt-3 space-y-2">
                                                            {[
                                                                { key: 'pdf', label: 'Configs & PDFs', path: basePaths.base_pdf_path },
                                                                { key: 'ocr', label: 'OCR Output', path: basePaths.base_ocr_path },
                                                                { key: 'text', label: 'Text Output', path: basePaths.base_text_path },
                                                            ].map(({ key, label, path }) => (
                                                                <div key={key} className="flex items-center gap-3">
                                                                    <button
                                                                        onClick={() => pickDirectory(key)}
                                                                        className="bg-amber-600 text-white text-xs font-semibold py-1.5 px-3 rounded-md hover:bg-amber-700 transition duration-200 whitespace-nowrap"
                                                                    >
                                                                        Select
                                                                    </button>
                                                                    <div className="text-xs">
                                                                        <span className="font-medium text-amber-800">{label}:</span>
                                                                        {pendingHandles[key] ? (
                                                                            <span className="text-green-700 ml-1">✓ {pendingHandles[key].name}</span>
                                                                        ) : (
                                                                            <span className="font-mono text-amber-600 ml-1">{path}</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {pendingHandles.pdf && pendingHandles.ocr && pendingHandles.text && (
                                                            <button
                                                                onClick={confirmDirectories}
                                                                className="mt-3 bg-green-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-green-700 transition duration-200"
                                                            >
                                                                Confirm &amp; Save
                                                            </button>
                                                        )}
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
                                                 onClick={() => setActiveTab('pdf-parser')}>
                                                <div className="text-sky-600 mb-3">
                                                    <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                    </svg>
                                                </div>
                                                <h3 className="text-lg font-semibold text-slate-800 mb-2">PDF Parser</h3>
                                                <p className="text-sm text-slate-600">
                                                    Parse PDFs using Tesseract OCR or Gemini LLM. Extract text, paragraphs, and structured content from scanned documents.
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

                                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 hover:bg-slate-100 transition-colors cursor-pointer"
                                                 onClick={() => setActiveTab('paragraph-classifier')}>
                                                <div className="text-orange-600 mb-3">
                                                    <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                </div>
                                                <h3 className="text-lg font-semibold text-slate-800 mb-2">Paragraph Classifier</h3>
                                                <p className="text-sm text-slate-600">
                                                    Manually fix Gemini OCR classification errors. View PDF pages alongside extracted blocks and re-classify each block type.
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

                        {activeTab === 'pdf-parser' && (
                            <PDFParser
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

                        {activeTab === 'paragraph-classifier' && (
                            <ParaClassifier
                                selectedFile={selectedFile}
                                baseDirectoryHandles={baseDirectoryHandles}
                                basePaths={basePaths}
                            />
                        )}

                    </div>
                </div>
            </div>
        </div>
    );
};

export default UIEval;