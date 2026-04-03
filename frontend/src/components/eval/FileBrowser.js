import React, { useState, useEffect, useRef } from 'react';
import { Spinner } from '../SharedComponents';

const FileBrowser = ({ isOpen, onClose, onFolderSelect, basePaths, baseDirectoryHandles, currentTab, startPath }) => {
    const [currentPath, setCurrentPath] = useState('');
    const [directories, setDirectories] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [pathHistory, setPathHistory] = useState(['']);
    const [basePdfHandle, setBasePdfHandle] = useState(null);
    const currentTabRef = useRef(currentTab);
    useEffect(() => { currentTabRef.current = currentTab; }, [currentTab]);

    useEffect(() => {
        if (isOpen && basePaths) {
            if (baseDirectoryHandles && baseDirectoryHandles.pdf && !basePdfHandle) {
                // Use the provided base directory handle
                setBasePdfHandle(baseDirectoryHandles.pdf);

                // Navigate to startPath if provided, otherwise start at root
                const initialPath = startPath || '';
                setCurrentPath(initialPath);

                // Build path history for the startPath
                if (initialPath) {
                    const pathParts = initialPath.split('/').filter(p => p);
                    const history = [''];
                    let buildPath = '';
                    for (const part of pathParts) {
                        buildPath = buildPath ? `${buildPath}/${part}` : part;
                        history.push(buildPath);
                    }
                    setPathHistory(history);
                } else {
                    setPathHistory(['']);
                }

                navigateToPath(baseDirectoryHandles.pdf, initialPath);
            } else if (!basePdfHandle) {
                initializeBasePdfFolder();
            }
        }
    }, [isOpen, basePaths, baseDirectoryHandles, startPath]);

    // Helper function to navigate to a specific path
    const navigateToPath = async (baseHandle, targetPath) => {
        try {
            let dirHandle = baseHandle;
            if (targetPath) {
                const pathParts = targetPath.split('/').filter(p => p);
                for (const part of pathParts) {
                    dirHandle = await dirHandle.getDirectoryHandle(part);
                }
            }
            await loadDirectory(dirHandle, targetPath);
        } catch (err) {
            console.error('Error navigating to path:', targetPath, err);
            // Fall back to root if navigation fails
            await loadDirectory(baseHandle, '');
        }
    };

    const initializeBasePdfFolder = async () => {
        // Don't automatically open the directory picker
        // Instead, show the file browser interface with instructions
        setCurrentPath('');
        setPathHistory(['']);
        setIsLoading(false);
    };

    const loadDirectory = async (dirHandle, path) => {
        setIsLoading(true);
        setError(null);
        
        try {
            const items = [];
            
            for await (const [name, handle] of dirHandle.entries()) {
                // Skip hidden files/directories (starting with '.')
                if (name.startsWith('.')) {
                    continue;
                }

                if (handle.kind === 'directory') {
                    items.push({
                        name,
                        handle,
                        path: path ? `${path}/${name}` : name,
                        type: 'directory'
                    });
                } else if (handle.kind === 'file') {
                    const tab = currentTabRef.current;
                    if (tab === 'scripture-eval' && name.toLowerCase().endsWith('.md')) {
                        items.push({
                            name,
                            handle,
                            path: path ? `${path}/${name}` : name,
                            type: 'file',
                            fileType: 'markdown'
                        });
                    } else if ((tab === 'pdf-parser' || tab === 'paragraph-eval' || tab === 'ocr-preview' || tab === 'paragraph-classifier') && name.toLowerCase().endsWith('.pdf')) {
                        items.push({
                            name,
                            handle,
                            path: path ? `${path}/${name}` : name,
                            type: 'file',
                            fileType: 'pdf'
                        });
                    }
                }
            }
            
            // Sort: directories first, then files, both alphabetically
            items.sort((a, b) => {
                if (a.type !== b.type) {
                    return a.type === 'directory' ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
            
            console.log(`Loaded ${items.filter(i => i.type === 'directory').length} directories and ${items.filter(i => i.type === 'file').length} PDF files from path "${path}"`);
            setDirectories(items);
            setCurrentPath(path);
        } catch (err) {
            console.error('Error loading directory:', err);
            setError(`Error loading directory: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleItemClick = async (item) => {
        if (item.type === 'directory') {
            // Navigate into directory
            const newPath = item.path;
            setPathHistory([...pathHistory, newPath]);
            await loadDirectory(item.handle, newPath);
        } else if (item.type === 'file') {
            // Select file (PDF or Markdown)
            handleSelectFile(item);
        }
    };

    const handleSelectFile = (file) => {
        if (basePaths && basePdfHandle) {
            if (file.fileType === 'markdown') {
                // Handle markdown file selection for Scripture Eval
                const markdownFilePath = file.path;
                
                console.log('Markdown file selected:', {
                    markdownFilePath,
                    fileName: file.name
                });
                
                onFolderSelect({
                    relativePath: markdownFilePath,
                    selectedFileName: file.name,
                    fileType: 'markdown'
                });
                onClose();
            } else if (file.fileType === 'pdf') {
                // Handle PDF file selection for OCR/Paragraph Eval
                const pdfFilePath = file.path;
                
                // Remove .pdf extension to get directory name
                const pdfFileName = file.name.replace(/\.pdf$/i, '');
                const pdfDirPath = pdfFilePath.replace(/\/[^/]+\.pdf$/i, '');
                
                // Create the directory path by replacing the file with directory name
                const relativeDirPath = pdfDirPath ? `${pdfDirPath}/${pdfFileName}` : pdfFileName;
                
                // Construct source and target paths
                const sourcePath = `${basePaths.base_ocr_path}/${relativeDirPath}`;
                const targetPath = `${basePaths.base_text_path}/${relativeDirPath}`;
                
                console.log('PDF file selected:', {
                    pdfFilePath,
                    pdfFileName,
                    relativeDirPath,
                    sourcePath,
                    targetPath
                });
                
                onFolderSelect({
                    relativePath: relativeDirPath,
                    sourcePath,
                    targetPath,
                    selectedFolderName: pdfFileName,
                    selectedPDFFile: file.name,
                    pdfFilePath: pdfFilePath,
                    pdfFileHandle: file.handle
                });
                onClose();
            }
        }
    };

    const handleBackClick = async () => {
        if (pathHistory.length > 1) {
            const newHistory = [...pathHistory];
            newHistory.pop();
            const previousPath = newHistory[newHistory.length - 1];
            
            setPathHistory(newHistory);
            
            // Navigate back to the previous directory
            let targetHandle = basePdfHandle;
            if (previousPath) {
                const pathParts = previousPath.split('/');
                for (const part of pathParts) {
                    targetHandle = await targetHandle.getDirectoryHandle(part);
                }
            }
            
            await loadDirectory(targetHandle, previousPath);
        }
    };

    const handleSelectFolder = () => {
        if (basePaths && basePdfHandle) {
            const relativePath = currentPath || '';
            
            // Construct source and target paths
            const sourcePath = relativePath 
                ? `${basePaths.base_ocr_path}/${relativePath}`
                : basePaths.base_ocr_path;
            const targetPath = relativePath 
                ? `${basePaths.base_text_path}/${relativePath}`
                : basePaths.base_text_path;
            
            onFolderSelect({
                relativePath,
                sourcePath,
                targetPath,
                selectedFolderName: currentPath ? currentPath.split('/').pop() : basePdfHandle.name || 'Root'
            });
            onClose();
        }
    };

    const getCurrentFolderName = () => {
        if (!currentPath) return basePdfHandle?.name || 'Root';
        return currentPath.split('/').pop();
    };

    const getBreadcrumbs = () => {
        if (!currentPath) return [{ name: basePdfHandle?.name || 'Root', path: '' }];
        
        const parts = currentPath.split('/');
        const breadcrumbs = [{ name: basePdfHandle?.name || 'Root', path: '' }];
        
        let buildPath = '';
        parts.forEach(part => {
            buildPath = buildPath ? `${buildPath}/${part}` : part;
            breadcrumbs.push({ name: part, path: buildPath });
        });
        
        return breadcrumbs;
    };

    const handleBreadcrumbClick = async (targetPath) => {
        if (targetPath === currentPath) return;
        
        // Update path history to this point
        const breadcrumbs = getBreadcrumbs();
        const targetIndex = breadcrumbs.findIndex(b => b.path === targetPath);
        if (targetIndex !== -1) {
            const newHistory = pathHistory.slice(0, targetIndex + 1);
            setPathHistory(newHistory);
        }
        
        // Navigate to the target directory
        let targetHandle = basePdfHandle;
        if (targetPath) {
            const pathParts = targetPath.split('/');
            for (const part of pathParts) {
                targetHandle = await targetHandle.getDirectoryHandle(part);
            }
        }
        
        await loadDirectory(targetHandle, targetPath);
    };

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            onClick={onClose}
        >
            <div 
                className="rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col"
                style={{ backgroundColor: 'var(--bg-card)' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">Select Folder or PDF File</h3>
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-700 p-1 rounded"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Breadcrumbs - only show when base folder is selected */}
                {basePdfHandle && (
                    <div className="px-4 py-2 border-b border-slate-200" style={{ backgroundColor: 'var(--bg-surface)' }}>
                        <div className="flex items-center space-x-1 text-sm">
                            {getBreadcrumbs().map((crumb, index) => (
                                <React.Fragment key={crumb.path}>
                                    {index > 0 && (
                                        <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    )}
                                    <button
                                        onClick={() => handleBreadcrumbClick(crumb.path)}
                                        className={`hover:text-sky-600 ${
                                            crumb.path === currentPath 
                                                ? 'text-sky-600 font-medium' 
                                                : 'text-slate-600'
                                        }`}
                                    >
                                        {crumb.name}
                                    </button>
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                )}

                {/* Navigation Controls - only show when base folder is selected */}
                {basePdfHandle && (
                    <div className="px-4 py-2 border-b border-slate-200" style={{ backgroundColor: 'var(--bg-surface)' }}>
                        <div className="flex items-center justify-between">
                            <button
                                onClick={handleBackClick}
                                disabled={pathHistory.length <= 1 || isLoading}
                                className="flex items-center px-3 py-1 text-sm bg-slate-200 text-slate-700 rounded disabled:opacity-50 hover:bg-slate-300 transition-colors"
                            >
                                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                                </svg>
                                Back
                            </button>

                            <div className="text-sm text-slate-600">
                                Current: <span className="font-medium">{getCurrentFolderName()}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Directory Listing */}
                <div className="flex-1 overflow-y-auto p-4">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                            <p className="text-red-800 text-sm">{error}</p>
                        </div>
                    )}

                    {!basePdfHandle ? (
                        // Initial Setup Screen
                        <div className="text-center py-8">
                            <svg className="mx-auto h-16 w-16 text-blue-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
                            </svg>
                            <h3 className="text-lg font-semibold text-slate-800 mb-2">Select Base PDF Folder</h3>
                            <p className="text-slate-600 mb-4">
                                Please select your base PDF folder to begin browsing:
                            </p>
                            {basePaths && (
                                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-left max-w-md mx-auto">
                                    <p className="text-sm text-blue-800">
                                        <strong>Expected location:</strong><br/>
                                        <code className="font-mono">{basePaths.base_pdf_path}</code>
                                    </p>
                                </div>
                            )}
                            <button
                                onClick={async () => {
                                    console.log('Button clicked, opening directory picker...');
                                    try {
                                        const handle = await window.showDirectoryPicker();
                                        console.log('Directory selected:', handle.name);
                                        setBasePdfHandle(handle);
                                        setCurrentPath('');
                                        setPathHistory(['']);
                                        console.log('About to call loadDirectory...');
                                        await loadDirectory(handle, '');
                                    } catch (err) {
                                        console.log('Error in directory selection:', err);
                                        if (err.name !== 'AbortError') {
                                            setError('Failed to select base PDF folder. Please try again.');
                                        }
                                    }
                                }}
                                className="bg-blue-600 text-white font-semibold py-3 px-6 rounded-md hover:bg-blue-700 transition duration-200"
                            >
                                Select Base PDF Folder
                            </button>
                        </div>
                    ) : isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Spinner />
                            <span className="ml-2 text-slate-600">Loading directories...</span>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {directories.length === 0 ? (
                                <div className="text-center py-8 text-slate-500">
                                    <svg className="mx-auto h-12 w-12 text-slate-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
                                    </svg>
                                    <p>
                                        {currentTabRef.current === 'scripture-eval'
                                            ? 'No directories or .md files found'
                                            : 'No subdirectories or PDF files found'}
                                    </p>
                                </div>
                            ) : (
                                directories.map((item) => (
                                    <div
                                        key={item.path}
                                        className={`flex items-center p-3 border border-slate-200 rounded-lg hover:bg-neutral-100 hover:border-slate-300 cursor-pointer transition-colors ${
                                            item.type === 'file' ? (item.fileType === 'markdown' ? 'bg-green-50 border-green-200 hover:bg-green-100' : 'bg-orange-50 border-orange-200 hover:bg-orange-100') : ''
                                        }`}
                                        onClick={() => handleItemClick(item)}
                                    >
                                        {item.type === 'directory' ? (
                                            <svg className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
                                            </svg>
                                        ) : (
                                            <svg className="w-5 h-5 text-red-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                            </svg>
                                        )}
                                        <span className="text-slate-800 font-medium">{item.name}</span>
                                        {item.type === 'directory' ? (
                                            <svg className="w-4 h-4 text-slate-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        ) : (
                                            <span className={`text-xs ml-auto px-2 py-1 rounded font-medium ${
                                                item.fileType === 'markdown' 
                                                    ? 'text-green-600 bg-green-100' 
                                                    : 'text-orange-600 bg-orange-100'
                                            }`}>
                                                {item.fileType === 'markdown' ? 'MD' : 'PDF'}
                                            </span>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default FileBrowser;
