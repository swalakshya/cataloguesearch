import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Spinner } from '../SharedComponents';
import { api } from '../../services/api';
import FileBrowser from './FileBrowser';
import BookmarksModal from '../BookmarksModal';
import ShowBookmarksButton from '../ShowBookmarksButton';
import { CopyPathButton, CopyPathButtons } from '../CopyPathButton';
import {
    storeDirectoryHandles,
    getStoredDirectoryHandles,
    clearStoredDirectoryHandles,
    validateDirectoryHandles,
    navigateToPath,
    loadFilesFromDirectory,
    readFileContent
} from '../../utils/directoryHandlers';
import { usePDFJsViewer } from '../../hooks/usePDFJsViewer';
import useArrowNavigation from '../../hooks/useArrowNavigation';
import BlockAnnotator from './BlockAnnotator';
import { BLOCK_TYPES } from './classifierConstants';


const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

const ParagraphGenEval = ({ onBrowseFiles, showFileBrowser, onCloseFileBrowser, basePaths: parentBasePaths, selectedFolder: propSelectedFolder, baseDirectoryHandles: parentBaseDirectoryHandles, onPdfParentDirChange }) => {
    const [selectedFolder, setSelectedFolder] = useState(propSelectedFolder || null);
    const [sourceHandle, setSourceHandle] = useState(null);
    const [targetHandle, setTargetHandle] = useState(null);
    const [fileList, setFileList] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [sourceContent, setSourceContent] = useState('');
    const [targetContent, setTargetContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [jumpPageNumber, setJumpPageNumber] = useState('');
    const [skipPdfPages, setSkipPdfPages] = useState([]);
    const [basePaths, setBasePaths] = useState(parentBasePaths || null);
    const [baseDirectoryHandles, setBaseDirectoryHandles] = useState(parentBaseDirectoryHandles || {
        pdf: null,
        ocr: null,
        text: null
    });
    const [permissionsGranted, setPermissionsGranted] = useState(!!parentBaseDirectoryHandles);
    const [pendingHandles, setPendingHandles] = useState({ pdf: null, ocr: null, text: null });
    const pickerActiveRef = useRef(false);
    
    // Bookmarks / PDF rendering — via shared hook (used for single-page PDFs only)
    const {
        pdfDoc,
        loadPDF,
        renderPage: renderPDFPageFromHook,
        reset: resetPdfViewer,
    } = usePDFJsViewer();
    const [showBookmarksModal, setShowBookmarksModal] = useState(false);
    const [bookmarks, setBookmarks] = useState([]);
    const [parsedBookmarks, setParsedBookmarks] = useState([]);
    const [subSections, setSubSections] = useState([]);

    // PDF page rendering
    const [pdfPageDataUrl, setPdfPageDataUrl] = useState(null);
    const [leftView, setLeftView] = useState('pdf'); // 'pdf' | 'json'

    // JSON view — editable blocks
    const [editableBlocks, setEditableBlocks] = useState([]);
    const [originalTypes, setOriginalTypes] = useState([]);
    const [jsonSaveStatus, setJsonSaveStatus] = useState(null);

    // Multi-page PDF mapping (null = single-page PDF, no cropping needed)
    const [pageMapping, setPageMapping] = useState(null);
    const pageMappingRef = useRef(null);  // sync ref so renderPDFPage sees latest value immediately

    // Store PDF's parent directory handle for better UX when browsing
    const [pdfParentDirHandle, setPdfParentDirHandle] = useState(null);

    // "Latest function" refs for processSelectedFolder/loadPDFForSinglePage --
    // both are large, unmemoized functions with their own web of dependencies,
    // referenced from effects further up/down. Calling them through a ref kept
    // in sync on every render (rather than depending on the function directly)
    // avoids both a TDZ error (processSelectedFolder is declared after the
    // effect that needs it) and, for loadPDFForSinglePage, a genuine infinite
    // loop: unlike processSelectedFolder's effect, that one's guard condition
    // doesn't change based on anything loadPDFForSinglePage itself sets, so a
    // literal "add it to the deps array" fix would re-run it on every render,
    // forever.
    const processSelectedFolderRef = useRef(null);
    const loadPDFForSinglePageRef = useRef(null);

    // Load persisted directory handles on component mount
    useEffect(() => {
        const loadPersistedHandles = async () => {
            try {
                const stored = await getStoredDirectoryHandles();
                if (stored.pdf && stored.ocr && stored.text) {
                    const isValid = await validateDirectoryHandles(stored);
                    if (isValid) {
                        setBaseDirectoryHandles(stored);
                        setPermissionsGranted(true);
                        
                        // console.log('Successfully restored directory handles from storage');
                    } else {
                        console.log('Stored handles no longer have permission, clearing storage');
                        await clearStoredDirectoryHandles();
                    }
                }
            } catch (err) {
                console.log('Could not restore directory handles:', err);
                await clearStoredDirectoryHandles();
            }
        };

        loadPersistedHandles();
    }, []);


    // Load base paths from API if not provided by parent
    useEffect(() => {
        if (!parentBasePaths) {
            const loadBasePaths = async () => {
                try {
                    const response = await fetch(`${API_BASE_URL}/eval/paths`);
                    const data = await response.json();
                    setBasePaths(data);
                } catch (err) {
                    setError(`Failed to load configuration: ${err.message}`);
                }
            };
            loadBasePaths();
        } else {
            setBasePaths(parentBasePaths);
        }
    }, [parentBasePaths]);

    const pickDirectory = async (key) => {
        if (pickerActiveRef.current) return;
        if (!window.showDirectoryPicker) {
            setError('File System Access API is not supported in this browser. Please use Google Chrome for the best experience.');
            return;
        }
        pickerActiveRef.current = true;
        try {
            const handle = await window.showDirectoryPicker();
            setPendingHandles(prev => ({ ...prev, [key]: handle }));
        } catch (err) {
            if (err.name !== 'AbortError') {
                setError(`Error picking directory: ${err.message}`);
            }
        } finally {
            pickerActiveRef.current = false;
        }
    };

    const confirmDirectories = async () => {
        const handles = { ...pendingHandles };
        setBaseDirectoryHandles(handles);
        setPermissionsGranted(true);
        setPendingHandles({ pdf: null, ocr: null, text: null });
        try {
            await storeDirectoryHandles(handles);
        } catch (err) {
            console.warn('Could not persist directory handles:', err);
        }
    };

    // Update selectedFolder when prop changes and automatically process if permissions granted.
    // (processSelectedFolder is called through processSelectedFolderRef -- see its
    // declaration above -- since it's declared below and referencing it directly
    // in this deps array would throw "Cannot access before initialization".)
    useEffect(() => {
        if (propSelectedFolder && propSelectedFolder !== selectedFolder) {
            setSelectedFolder(propSelectedFolder);
            // Automatically process if we have base directory permissions
            if (propSelectedFolder && permissionsGranted) {
                processSelectedFolderRef.current(propSelectedFolder);
            }
        }
    }, [propSelectedFolder, permissionsGranted, selectedFolder]);

    // Process selected folder using base directory handles
    const processSelectedFolder = async (selection) => {
        if (!baseDirectoryHandles.ocr || !baseDirectoryHandles.text) {
            setError('Base directory permissions not granted. Please grant permissions first.');
            return;
        }

        try {
            setIsLoading(true);
            setError(null);

            // Clear the previous document's loaded PDF and rendered page image up
            // front, before navigating to the new one. Without this, displayFiles()
            // below can render the *new* document's page number from the *old*
            // pdfDoc, since loadPDFForSinglePage() (which loads the new PDF into
            // pdfDoc) runs asynchronously in a separate effect and isn't guaranteed
            // to finish first.
            resetPdfViewer();
            setPdfPageDataUrl(null);

            // Navigate to the relative path in both OCR and Text directories
            const relativePath = selection.relativePath;
            
            // Get source directory handle (OCR)
            const sourceDir = await navigateToPath(baseDirectoryHandles.ocr, relativePath);
            if (!sourceDir) {
                setError(`Source directory not found: ${selection.sourcePath}`);
                return;
            }
            
            // Get target directory handle (Text)
            const targetDir = await navigateToPath(baseDirectoryHandles.text, relativePath);
            if (!targetDir) {
                setError(`Target directory not found: ${selection.targetPath}`);
                return;
            }

            setSourceHandle(sourceDir);
            setTargetHandle(targetDir);

            // Fetch page-mapping + bookmarks from backend (works for both multi-page and single-page)
            const ocrRelPath = relativePath;
            try {
                const [mappingData, bookmarkData, parsedBookmarkData] = await Promise.all([
                    fetch(`${API_BASE_URL}/eval/pdf/page-mapping?ocr_relative_path=${encodeURIComponent(ocrRelPath)}`).then(r => r.ok ? r.json() : null),
                    fetch(`${API_BASE_URL}/eval/pdf/bookmarks?ocr_relative_path=${encodeURIComponent(ocrRelPath)}`).then(r => r.ok ? r.json() : null),
                    fetch(`${API_BASE_URL}/eval/pdf/metadata?ocr_relative_path=${encodeURIComponent(ocrRelPath)}`).then(r => r.ok ? r.json() : null),
                ]);
                const mapping = mappingData?.page_mapping || null;
                setPageMapping(mapping);
                pageMappingRef.current = mapping;
                const adapted = (bookmarkData?.bookmarks || []).map(b => ({
                    ...b,
                    dest: true,
                    pageNumber: b.logical_page,
                    items: [],
                }));
                setBookmarks(adapted);
                setParsedBookmarks(parsedBookmarkData?.bookmarks || []);
                setSubSections(parsedBookmarkData?.sub_sections || []);
            } catch (e) {
                console.warn('Could not load page-mapping/bookmarks from backend:', e);
                setPageMapping(null);
                pageMappingRef.current = null;
                setBookmarks([]);
                setParsedBookmarks([]);
                setSubSections([]);
            }

            // Load and display files
            const files = await loadFiles(sourceDir);
            if (files.length > 0) {
                setCurrentIndex(0);
                await displayFiles(files[0], sourceDir, targetDir, relativePath);
            }
        } catch (err) {
            setError(`Error processing selected folder: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };
    processSelectedFolderRef.current = processSelectedFolder;


    const handleFolderSelect = async (selection) => {
        setSelectedFolder(selection);
        setError(null);
        
        // If permissions are granted, process immediately, otherwise use old flow
        if (permissionsGranted) {
            processSelectedFolder(selection);
        } else {
            promptForDirectories(selection);
        }
    };

    // Fallback function for manual directory selection (when permissions not granted)
    const promptForDirectories = async (selection) => {
        try {
            // First, try to get the PDF parent directory handle for better UX
            let startDirHandle = null;
            if (selection.selectedPDFFile && baseDirectoryHandles.pdf) {
                try {
                    const pathParts = selection.relativePath.split('/');
                    const pdfDirectory = pathParts.slice(0, -1).join('/');
                    const pdfDirHandle = await navigateToPath(
                        baseDirectoryHandles.pdf,
                        pdfDirectory
                    );
                    if (pdfDirHandle) {
                        startDirHandle = pdfDirHandle;
                        setPdfParentDirHandle(pdfDirHandle);
                        console.log('Using PDF parent directory as starting point:', pdfDirectory);
                    }
                } catch (err) {
                    console.log('Could not navigate to PDF parent directory:', err);
                }
            }

            const message = `Selected: ${selection.selectedPDFFile || selection.selectedFolderName}

Calculated paths:
• Source: ${selection.sourcePath}
• Target: ${selection.targetPath}

Please select the SOURCE directory (${selection.sourcePath})`;

            if (window.confirm(message)) {
                // Use PDF parent directory as starting point if available
                const pickerOptions = startDirHandle ? { startIn: startDirHandle } : {};
                const sourceHandle = await window.showDirectoryPicker(pickerOptions);
                setSourceHandle(sourceHandle);

                const targetMessage = `Now select the TARGET directory (${selection.targetPath})`;
                if (window.confirm(targetMessage)) {
                    // Use PDF parent directory as starting point if available
                    const targetHandle = await window.showDirectoryPicker(pickerOptions);
                    setTargetHandle(targetHandle);

                    checkAndStart(sourceHandle, targetHandle);
                } else {
                    setSourceHandle(null);
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                setError(`Error selecting directories: ${err.message}`);
            }
            console.log("User cancelled directory selection.");
        }
    };

    const checkAndStart = async (sourceDir, targetDir) => {
        if (sourceDir && targetDir) {
            setIsLoading(true);
            setError(null);
            try {
                const files = await loadFiles(sourceDir);
                if (files.length > 0) {
                    setCurrentIndex(0);
                    await displayFiles(files[0], sourceDir, targetDir);
                }
            } catch (err) {
                setError(`Error loading files: ${err.message}`);
            } finally {
                setIsLoading(false);
            }
        }
    };

    const loadFiles = async (sourceDir) => {
        const sortedFiles = await loadFilesFromDirectory(sourceDir);
        setFileList(sortedFiles);
        return sortedFiles;
    };


    // Referenced (as a dependency) by navigate's useCallback below. displayFiles
    // itself isn't memoized -- it calls renderPDFPage, which is declared *after*
    // displayFiles and itself closes over the PDF.js hook's pdfDoc/renderPage --
    // so memoizing displayFiles for real would mean reordering and
    // ref-indirecting through that whole chain too, which isn't worth the
    // regression risk for a lint cleanup. navigate's instability from this is
    // harmless: useArrowNavigation only uses it to add/remove a keydown listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const displayFiles = async (fileName, sourceDir = sourceHandle, targetDir = targetHandle, ocrRelPath = selectedFolder?.relativePath) => {
        if (!fileName || !sourceDir || !targetDir) return;

        setIsLoading(true);
        try {
            // Extract page number from filename (handle both .txt and .json extensions)
            const pageNumber = parseInt(
                fileName.replace('page_', '').replace(/\.(txt|json)$/, ''),
                10
            );

            // Target directory has .txt files for indexed pages; some pages (e.g. preamble
            // pages excluded from all sub-sections) intentionally have no .txt file.
            const targetFileName = `page_${String(pageNumber).padStart(4, '0')}.txt`;
            const targetText = await readFileContent(targetDir, targetFileName);
            setTargetContent(targetText.startsWith('--- File not found') ? '' : targetText);

            // Always load OCR JSON for the JSON view
            const ocrJsonText = await readFileContent(sourceDir, fileName);
            try {
                const parsed = JSON.parse(ocrJsonText);
                setEditableBlocks(parsed);
                setOriginalTypes(parsed.map(b => b.type));
            } catch {
                setEditableBlocks([]);
                setOriginalTypes([]);
            }
            setJsonSaveStatus(null);

            // Render PDF page if multi-page mapping exists or PDF.js doc is loaded
            if (pageMappingRef.current || pdfDoc) {
                setSourceContent(''); // Clear source content when showing PDF
                await renderPDFPage(pageNumber, ocrRelPath);
            } else {
                // Fallback: still read source content if PDF is not loaded
                setPdfPageDataUrl(null); // Clear PDF preview when showing source
                setSourceContent(ocrJsonText);
            }

            // Update jump page number input
            setJumpPageNumber(pageNumber.toString());
        } catch (err) {
            setError(`Error displaying files: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    // Wrapped in useCallback to satisfy exhaustive-deps below, but -- like
    // handlePageNavigation in PDFParser.js -- this doesn't achieve true stability:
    // displayFiles is itself a large, unmemoized function with its own web of
    // dependencies, so navigate is still a new reference every render regardless.
    // Fully memoizing that chain is out of scope for a lint cleanup. useArrowNavigation
    // only uses these to add/remove a keydown listener, so the extra churn is harmless.
    const navigate = useCallback((direction) => {
        const newIndex = currentIndex + direction;
        if (newIndex >= 0 && newIndex < fileList.length) {
            setCurrentIndex(newIndex);
            displayFiles(fileList[newIndex]);
        }
    }, [currentIndex, fileList, displayFiles]);

    useArrowNavigation(
        useCallback(() => navigate(-1), [navigate]),
        useCallback(() => navigate(1),  [navigate]),
        fileList.length > 0,
    );

    const jumpToPage = () => {
        const pageNum = parseInt(jumpPageNumber, 10);
        if (isNaN(pageNum) || pageNum < 1) {
            return;
        }

        // Try both .txt and .json extensions
        const pagePrefix = `page_${String(pageNum).padStart(4, '0')}`;
        const fileName = fileList.find(f => f.startsWith(pagePrefix));

        if (fileName) {
            const foundIndex = fileList.indexOf(fileName);
            setCurrentIndex(foundIndex);
            displayFiles(fileName);
        } else {
            setError(`Page ${pageNum} not found in the comparison files.`);
            setTimeout(() => setError(null), 3000);
        }
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            jumpToPage();
        }
    };

    const getCurrentFileName = () => {
        return currentIndex >= 0 && currentIndex < fileList.length
            ? fileList[currentIndex]
            : '';
    };

    // Load PDF via PDF.js only for single-page PDFs (no page_mapping)
    const loadPDFForSinglePage = async () => {
        if (!selectedFolder?.selectedPDFFile || !baseDirectoryHandles.pdf) return;
        if (pageMapping) return;  // multi-page: backend handles rendering

        try {
            const pathParts = selectedFolder.relativePath.split('/');
            const pdfDirectory = pathParts.slice(0, -1).join('/');
            const pdfDirHandle = await navigateToPath(baseDirectoryHandles.pdf, pdfDirectory);
            if (!pdfDirHandle) return;

            setPdfParentDirHandle(pdfDirHandle);
            if (onPdfParentDirChange) onPdfParentDirChange(pdfDirectory);

            const pdfFileHandle = await pdfDirHandle.getFileHandle(selectedFolder.selectedPDFFile);
            const pdfFile = await pdfFileHandle.getFile();
            const arrayBuffer = await pdfFile.arrayBuffer();
            await loadPDF({ data: arrayBuffer });
        } catch (err) {
            console.error('Error loading PDF:', err);
        }
    };
    loadPDFForSinglePageRef.current = loadPDFForSinglePage;

    // Handle bookmark click — backend bookmarks already have logical_page as pageNumber
    const handleBookmarkClick = (bookmark) => {
        jumpToPageByNumber(bookmark.logical_page ?? bookmark.pageNumber);
    };

    // Jump to a specific page number (helper function)
    const jumpToPageByNumber = (pageNumber) => {
        const pagePrefix = `page_${String(pageNumber).padStart(4, '0')}`;
        const fileName = fileList.find(f => f.startsWith(pagePrefix));
        if (fileName) {
            const foundIndex = fileList.indexOf(fileName);
            setCurrentIndex(foundIndex);
            displayFiles(fileName);
            setJumpPageNumber(pageNumber.toString());
        } else {
            setError(`Page ${pageNumber} not found in the comparison files.`);
            setTimeout(() => setError(null), 3000);
        }
    };

    // Render a specific PDF page: use backend for multi-page, PDF.js for single-page
    const renderPDFPage = async (pageNumber, ocrRelPath = selectedFolder?.relativePath) => {
        if (pageMappingRef.current) {
            try {
                const r = await fetch(`${API_BASE_URL}/eval/pdf/page-image?ocr_relative_path=${encodeURIComponent(ocrRelPath)}&logical_page=${pageNumber}`);
                const data = await r.json();
                if (r.ok) {
                    setPdfPageDataUrl(`data:image/png;base64,${data.image}`);
                } else {
                    setError(`Error fetching page image: ${data.error || r.status}`);
                }
            } catch (e) {
                console.error('Error fetching page image:', e);
                setError(`Error fetching page image: ${e.message}`);
            }
        } else {
            const dataUrl = await renderPDFPageFromHook(pageNumber);
            if (dataUrl) {
                setPdfPageDataUrl(dataUrl);
            } else {
                setError(`Error rendering PDF page ${pageNumber}`);
            }
        }
    };

    // Load PDF (single-page only) when a PDF is selected and directories are set up.
    // Calls through loadPDFForSinglePageRef -- see its declaration above -- rather
    // than depending on loadPDFForSinglePage directly: that function's identity
    // changes every render, but nothing it does changes this effect's guard
    // condition, so literally adding it as a dependency would re-run it on every
    // render forever (repeatedly re-fetching and re-loading the same PDF).
    useEffect(() => {
        if (selectedFolder?.selectedPDFFile && permissionsGranted && sourceHandle && targetHandle) {
            loadPDFForSinglePageRef.current();
        }
    }, [selectedFolder, permissionsGranted, sourceHandle, targetHandle]);

    // Re-render the current page once a (single-page) pdfDoc finishes loading.
    // displayFiles() already renders the page as soon as a folder is selected,
    // but at that point pdfDoc may still be the *previous* document's (the load
    // above is async and racy against it) or null (right after the reset in
    // processSelectedFolder) -- either way that initial render can be stale or
    // skipped. This effect corrects the picture the moment the right pdfDoc is
    // actually in hand, without waiting for the user to click Next/Previous.
    useEffect(() => {
        if (!pdfDoc || pageMappingRef.current) return;
        const fileName = getCurrentFileName();
        if (!fileName) return;
        const pageNumber = parseInt(fileName.replace('page_', '').replace(/\.(txt|json)$/, ''), 10);
        if (!pageNumber) return;
        renderPDFPage(pageNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pdfDoc]);

    // Fetch scan-config to get skip_pdf_pages when folder changes
    useEffect(() => {
        if (!selectedFolder?.relativePath) {
            setSkipPdfPages([]);
            return;
        }
        const pdfRelPath = selectedFolder.relativePath + (selectedFolder.selectedPDFFile ? `/${selectedFolder.selectedPDFFile}` : '.pdf');
        fetch(`${API_BASE_URL}/eval/ocr/scan-config?relative_path=${encodeURIComponent(pdfRelPath)}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                setSkipPdfPages(data?.skip_pdf_pages || []);
            })
            .catch(() => setSkipPdfPages([]));
    }, [selectedFolder]);

    // Helper functions to construct file paths for copy buttons
    const getPdfPath = () => {
        if (!basePaths || !selectedFolder?.relativePath || !selectedFolder?.selectedPDFFile) {
            return '';
        }
        return `${basePaths.base_pdf_path}/${selectedFolder.relativePath}/${selectedFolder.selectedPDFFile}`;
    };

    const getJsonPath = () => {
        if (!basePaths || !selectedFolder?.relativePath || currentIndex < 0 || !fileList[currentIndex]) {
            return '';
        }
        return `${basePaths.base_ocr_path}/${selectedFolder.relativePath}/${fileList[currentIndex]}`;
    };

    const getTxtPath = () => {
        if (!basePaths || !selectedFolder?.relativePath || !jumpPageNumber) {
            return '';
        }
        const txtFileName = `page_${String(jumpPageNumber).padStart(4, '0')}.txt`;
        return `${basePaths.base_text_path}/${selectedFolder.relativePath}/${txtFileName}`;
    };

    const getScanConfigPath = () => {
        if (!basePaths || !selectedFolder?.relativePath) return '';
        return `${basePaths.base_pdf_path}/${selectedFolder.relativePath}/scan_config.json`;
    };

    const getDebugInfo = () => {
        return [
            `scan_config: ${getScanConfigPath()}`,
            `ocr json:    ${getJsonPath()}`,
            `txt:         ${getTxtPath()}`,
        ].join('\n');
    };

    // Show directory selection if no directories selected
    if (!sourceHandle || !targetHandle) {
        return (
            <div className="rounded-lg shadow-sm border border-slate-200" style={{ width: '130%', maxWidth: 'none', backgroundColor: 'var(--bg-card)' }}>
                {/* Header */}
                <div className="p-4 border-b border-slate-200">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">Paragraph Generation Evaluation</h2>
                    <p className="text-slate-600">Compare generated paragraphs between source and target directories</p>
                </div>

                {/* Directory Selection */}
                <div className="p-8 text-center">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4">Select Directories to Compare</h3>
                    <p className="text-slate-600 mb-6">Please select the source and target directories to begin comparison.</p>
                    
                    {basePaths && (
                        <div className="mb-6 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-surface)' }}>
                            <h4 className="font-semibold text-slate-700 mb-2">Configuration Paths:</h4>
                            <div className="text-sm text-slate-600 space-y-1">
                                <div><strong>Base PDF:</strong> {basePaths.base_pdf_path}</div>
                                <div><strong>OCR Path:</strong> {basePaths.base_ocr_path}</div>
                                <div><strong>Text Path:</strong> {basePaths.base_text_path}</div>
                            </div>
                        </div>
                    )}
                    
                    <div className="flex flex-col gap-4 max-w-md mx-auto">
                        {!permissionsGranted && (
                            <div className="mb-4">
                                <p className="text-sm text-slate-600 mb-3">
                                    Select each base directory individually, then click Confirm.
                                </p>
                                <div className="space-y-2">
                                    {[
                                        { key: 'pdf', label: 'Configs & PDFs', path: basePaths?.base_pdf_path },
                                        { key: 'ocr', label: 'OCR Output', path: basePaths?.base_ocr_path },
                                        { key: 'text', label: 'Text Output', path: basePaths?.base_text_path },
                                    ].map(({ key, label, path }) => (
                                        <div key={key} className="flex items-center gap-3">
                                            <button
                                                onClick={() => pickDirectory(key)}
                                                disabled={!basePaths}
                                                className="bg-sky-600 text-white text-xs font-semibold py-1.5 px-3 rounded-md hover:bg-sky-700 transition duration-200 whitespace-nowrap disabled:bg-slate-400"
                                            >
                                                Select
                                            </button>
                                            <div className="text-xs">
                                                <span className="font-medium text-slate-700">{label}:</span>
                                                {pendingHandles[key] ? (
                                                    <span className="text-green-700 ml-1">✓ {pendingHandles[key].name}</span>
                                                ) : (
                                                    <span className="font-mono text-slate-500 ml-1">{path}</span>
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
                        )}
                        
                        {permissionsGranted && (
                            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
                                <div className="flex items-center">
                                    <svg className="w-5 h-5 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    <span className="text-green-800 font-medium">Directory permissions granted!</span>
                                </div>
                                <p className="text-sm text-green-700 mt-2">
                                    Now you can select PDF files and comparisons will start automatically.
                                </p>
                            </div>
                        )}
                        
                        <p className="text-sm text-slate-600 mb-2">
                            Use the Browse Files button above to select a PDF file from the base PDF directory.
                            {permissionsGranted 
                                ? ' Comparisons will start automatically!' 
                                : ' You\'ll need to manually select directories for each comparison.'}
                        </p>
                        
                        {/* Only show detailed folder info when permissions are NOT granted (manual mode) */}
                        {!permissionsGranted && selectedFolder && (
                            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-left">
                                <h4 className="font-semibold text-blue-800 mb-2">
                                    {selectedFolder.selectedPDFFile ? 'Selected PDF File:' : 'Selected Folder:'}
                                </h4>
                                <div className="text-sm text-blue-700 space-y-1 mb-4">
                                    {selectedFolder.selectedPDFFile && (
                                        <div><strong>PDF File:</strong> {selectedFolder.selectedPDFFile}</div>
                                    )}
                                    <div><strong>Directory Name:</strong> {selectedFolder.selectedFolderName}</div>
                                    <div><strong>Relative Path:</strong> {selectedFolder.relativePath}</div>
                                    <div><strong>Source Path:</strong> {selectedFolder.sourcePath}</div>
                                    <div><strong>Target Path:</strong> {selectedFolder.targetPath}</div>
                                </div>
                                <button
                                    onClick={() => promptForDirectories(selectedFolder)}
                                    className="w-full bg-green-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-green-700 transition duration-200"
                                >
                                    Start Comparison - Select Directories
                                </button>
                            </div>
                        )}
                    </div>

                    {sourceHandle && (
                        <div className="mt-4 text-sm text-slate-600">
                            ✓ Source: {sourceHandle.name}
                        </div>
                    )}
                    {targetHandle && (
                        <div className="mt-2 text-sm text-slate-600">
                            ✓ Target: {targetHandle.name}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-lg shadow-sm border border-slate-200" style={{ width: '130%', maxWidth: 'none', backgroundColor: 'var(--bg-card)' }}>
                {/* Header */}
                <div className="p-4 border-b border-slate-200">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">Paragraph Generation Evaluation</h2>
                    <p className="text-slate-600">
                        {selectedFolder?.selectedPDFFile 
                            ? `Comparing: ${selectedFolder.relativePath}/${selectedFolder.selectedPDFFile}`
                            : `Comparing: ${sourceHandle?.name} vs ${targetHandle?.name}`
                        }
                    </p>
                </div>

            {/* Controls */}
            <div className="p-4 border-b border-slate-200" style={{ backgroundColor: 'var(--bg-surface)' }}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        {/* Navigation Controls */}
                        <button
                            onClick={() => navigate(-1)}
                            disabled={currentIndex <= 0 || isLoading}
                            className="px-3 py-2 bg-slate-200 text-slate-700 rounded disabled:opacity-50 hover:bg-slate-300 transition-colors"
                        >
                            ← Previous
                        </button>
                        
                        <div className="text-sm font-medium text-slate-700 min-w-[200px] text-center">
                            {getCurrentFileName() && (
                                <>Displaying: {getCurrentFileName()}</>
                            )}
                        </div>
                        
                        <button
                            onClick={() => navigate(1)}
                            disabled={currentIndex >= fileList.length - 1 || isLoading}
                            className="px-3 py-2 bg-slate-200 text-slate-700 rounded disabled:opacity-50 hover:bg-slate-300 transition-colors"
                        >
                            Next →
                        </button>
                    </div>

                    {/* Jump Controls and Bookmarks */}
                    <div className="flex items-center space-x-2">
                        {/* Show Bookmarks Button */}
                        <ShowBookmarksButton 
                            hasBookmarks={selectedFolder?.selectedPDFFile && bookmarks.length > 0}
                            onClick={() => setShowBookmarksModal(true)}
                        />
                        
                        <label className="text-sm font-medium text-slate-700">
                            Jump to Page:
                        </label>
                        <input
                            type="number"
                            min="1"
                            value={jumpPageNumber}
                            onChange={(e) => setJumpPageNumber(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="w-20 px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                            disabled={isLoading}
                        />
                        <button
                            onClick={jumpToPage}
                            disabled={isLoading}
                            className="px-3 py-1 text-sm bg-sky-600 text-white rounded-md hover:bg-sky-700 transition-colors disabled:bg-slate-300"
                        >
                            Go
                        </button>
                    </div>

                    {/* Reset Button */}
                    <button
                        onClick={() => {
                            setSourceHandle(null);
                            setTargetHandle(null);
                            setFileList([]);
                            setCurrentIndex(-1);
                            setSourceContent('');
                            setTargetContent('');
                            setEditableBlocks([]);
                            setOriginalTypes([]);
                            setJsonSaveStatus(null);
                            setError(null);
                            setPageMapping(null);
                            pageMappingRef.current = null;
                            setParsedBookmarks([]);
                        }}
                        className="px-4 py-2 text-sm bg-orange-600 text-white rounded-md hover:bg-orange-700 transition-colors"
                    >
                        Reset Directories
                    </button>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-red-800 text-sm">{error}</p>
                </div>
            )}

            {/* Loading State */}
            {isLoading && (
                <div className="p-4 text-center">
                    <Spinner />
                    <span className="ml-2 text-slate-600">Loading files...</span>
                </div>
            )}

            {/* Content Comparison */}
            {!isLoading && fileList.length > 0 && (
                <div className="flex flex-col lg:flex-row">
                    {/* PDF Page Column */}
                    <div className="flex-1 p-4 border-r border-slate-200">
                        <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-1 border border-slate-200 rounded-md p-0.5">
                                <button
                                    onClick={() => setLeftView('pdf')}
                                    className={`px-3 py-1 text-sm rounded transition-colors ${leftView === 'pdf' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                >PDF Page</button>
                                <button
                                    onClick={() => setLeftView('json')}
                                    className={`px-3 py-1 text-sm rounded transition-colors ${leftView === 'json' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                >View JSON</button>
                            </div>
                            <CopyPathButtons
                                pdfPath={getPdfPath()}
                                jsonPath={getJsonPath()}
                                disabled={!selectedFolder || !basePaths}
                            />
                        </div>
                        {leftView === 'json' && jsonSaveStatus && (
                            <div className={`mt-2 px-3 py-2 rounded text-sm ${jsonSaveStatus.ok
                                ? 'bg-green-50 border border-green-200 text-green-800'
                                : 'bg-red-50 border border-red-200 text-red-800'}`}>
                                {jsonSaveStatus.message}
                            </div>
                        )}
                        {leftView === 'json' && editableBlocks.length > 0 && (() => {
                            const editedCount = editableBlocks.filter((b, i) => b.type !== originalTypes[i]).length;
                            return (
                                <div className="flex items-center gap-2 mt-2">
                                    <button
                                        disabled={editedCount === 0}
                                        onClick={async () => {
                                            if (!window.confirm(`Save corrections for this page?`)) return;
                                            setJsonSaveStatus(null);
                                            try {
                                                const fileHandle = await sourceHandle.getFileHandle(fileList[currentIndex]);
                                                const writable = await fileHandle.createWritable();
                                                await writable.write(JSON.stringify(editableBlocks, null, 2));
                                                await writable.close();
                                                setOriginalTypes(editableBlocks.map(b => b.type));
                                                setJsonSaveStatus({ ok: true, message: 'Saved successfully.' });
                                            } catch (err) {
                                                setJsonSaveStatus({ ok: false, message: err.message });
                                            }
                                        }}
                                        className="px-4 py-1.5 bg-green-600 text-white text-sm font-semibold rounded hover:bg-green-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
                                    >
                                        Save{editedCount > 0 ? ` (${editedCount} edited)` : ''}
                                    </button>
                                    {editedCount > 0 && (
                                        <button
                                            onClick={() => {
                                                setEditableBlocks(prev => prev.map((b, i) => ({ ...b, type: originalTypes[i] })));
                                                setJsonSaveStatus(null);
                                            }}
                                            className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded hover:bg-slate-100 transition-colors"
                                        >
                                            Reset
                                        </button>
                                    )}
                                </div>
                            );
                        })()}
                        <div className="border border-slate-300 rounded-lg overflow-hidden mt-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
                            <div className="p-4 max-h-[700px] overflow-y-auto flex justify-center">
                                {leftView === 'json' ? (
                                    editableBlocks.length > 0 ? (
                                        <div className="w-full">
                                            <BlockAnnotator
                                                blocks={editableBlocks}
                                                originalTypes={originalTypes}
                                                blockTypes={BLOCK_TYPES}
                                                onReclassify={(idx, newType) =>
                                                    setEditableBlocks(prev => prev.map((b, i) =>
                                                        i === idx ? { ...b, type: newType } : b
                                                    ))
                                                }
                                            />
                                        </div>
                                    ) : (
                                        <div className="text-slate-500 text-center py-8 italic text-sm">No JSON available</div>
                                    )
                                ) : pdfPageDataUrl ? (
                                    <img
                                        src={pdfPageDataUrl}
                                        alt={`PDF Page ${jumpPageNumber}`}
                                        className="max-w-full h-auto"
                                    />
                                ) : sourceContent ? (
                                    <pre className="text-sm font-mono whitespace-pre-wrap text-slate-800 w-full">
                                        {sourceContent}
                                    </pre>
                                ) : (
                                    <div className="text-slate-500 text-center py-8">
                                        <p>No PDF page available</p>
                                        <p className="text-sm mt-2">Ensure PDF file is loaded</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Generated Paragraphs Column */}
                    <div className="flex-1 p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <h3 className="text-lg font-semibold text-slate-800 flex-shrink-0">Generated Paragraphs</h3>
                            {(() => {
                                const currentPage = parseInt(jumpPageNumber, 10);
                                const activeBookmark = parsedBookmarks.length && !isNaN(currentPage)
                                    ? parsedBookmarks.filter(b => b.page <= currentPage).at(-1) ?? null
                                    : null;
                                const activeSubSection = subSections.length && !isNaN(currentPage)
                                    ? subSections.find(ss => currentPage >= ss.start_page && currentPage <= ss.end_page) ?? null
                                    : null;
                                const LABELS = { pravachan_no: 'Pravachan', date: 'Date', gatha: 'Gatha', kalash: 'Kalash', shlok: 'Shlok', doha: 'Doha', kavya: 'Kavya', sutra: 'Sutra' };
                                const fields = activeBookmark ? Object.entries(LABELS).filter(([k]) => activeBookmark[k] != null) : [];
                                if (!activeSubSection && !fields.length) return null;
                                return (
                                    <div className="flex items-center gap-1 flex-wrap flex-1">
                                        {activeSubSection && (
                                            <span key="sub_section" className="bg-violet-100 text-violet-800 text-sm font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap">
                                                {activeSubSection.name}
                                            </span>
                                        )}
                                        {fields.map(([k, label]) => (
                                            <span key={k} className="bg-indigo-100 text-indigo-800 text-sm font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap">
                                                {label}: {activeBookmark[k]}
                                            </span>
                                        ))}
                                    </div>
                                );
                            })()}
                            <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                                <CopyPathButton
                                    path={getTxtPath()}
                                    label="TXT"
                                    disabled={!selectedFolder || !basePaths}
                                />
                                <span className="text-slate-400">|</span>
                                <CopyPathButton
                                    path={getDebugInfo()}
                                    label="Debug"
                                    disabled={!selectedFolder || !basePaths}
                                />
                            </div>
                        </div>
                        <div className="border border-slate-300 rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)' }}>
                            <div className="p-4 space-y-3 max-h-[700px] overflow-y-auto">
                                {!targetContent && skipPdfPages.includes(parseInt(jumpPageNumber)) && (
                                    <div className="text-amber-500 text-sm text-center py-8 font-semibold">
                                        Skipped!
                                    </div>
                                )}
                                {!targetContent && !skipPdfPages.includes(parseInt(jumpPageNumber)) && (
                                    <div className="text-slate-400 text-sm text-center py-8 italic">
                                        No indexed data
                                    </div>
                                )}
                                {targetContent.split('----').map((paragraph, index) => {
                                    const trimmedParagraph = paragraph.trim();
                                    if (!trimmedParagraph) return null;
                                    const wordCount = trimmedParagraph.split(/\s+/).filter(Boolean).length;

                                    return (
                                        <div
                                            key={index}
                                            className="border border-slate-200 rounded-lg p-3 transition-colors relative"
                                            style={{ backgroundColor: 'var(--bg-card)' }}
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="text-xs text-slate-500 font-semibold">
                                                    Paragraph {index + 1}
                                                </div>
                                                <span className="text-xs text-slate-400 bg-slate-200 rounded-full px-2 py-0.5 leading-none">
                                                    {wordCount}w
                                                </span>
                                            </div>
                                            <div className="text-sm text-slate-800 whitespace-pre-wrap font-mono">
                                                {trimmedParagraph}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* No Files Found */}
            {!isLoading && fileList.length === 0 && sourceHandle && targetHandle && (
                <div className="p-8 text-center text-slate-500">
                    <svg className="mx-auto h-12 w-12 text-slate-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p>No 'page_xxxx.txt' files found in the selected directories.</p>
                </div>
            )}

            {/* Bookmarks Modal */}
            {showBookmarksModal && (
                <BookmarksModal
                    isOpen={showBookmarksModal}
                    onClose={() => setShowBookmarksModal(false)}
                    bookmarks={bookmarks}
                    onBookmarkClick={handleBookmarkClick}
                    title={selectedFolder?.selectedPDFFile ? `Bookmarks - ${selectedFolder.selectedPDFFile}` : "PDF Bookmarks"}
                />
            )}
        </div>
    );
};

export default ParagraphGenEval;