import React, { useState, useRef } from 'react';

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

/**
 * Drop-in replacement for the hidden <input type="file"> + Upload label pattern.
 * Renders an Upload / URL toggle and calls onFileReady(File) in both cases.
 */
const FileOrUrlInput = ({ onFileReady, selectedFile, inputId = 'file-or-url-input' }) => {
    const [mode, setMode] = useState('upload');
    const [urlValue, setUrlValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [urlError, setUrlError] = useState(null);
    const fileInputRef = useRef(null);

    const switchMode = (next) => {
        setMode(next);
        setUrlError(null);
    };

    const handleUploadChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Reset so the same file can be re-selected later
        e.target.value = '';
        onFileReady(file);
    };

    const handleLoad = async () => {
        const trimmed = urlValue.trim();
        if (!trimmed) return;

        setIsLoading(true);
        setUrlError(null);

        try {
            const res = await fetch(
                `${API_BASE_URL}/eval/file/proxy?url=${encodeURIComponent(trimmed)}`
            );
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.detail || `HTTP ${res.status}`);
            }
            const blob = await res.blob();
            const filename =
                trimmed.split('/').pop().split('?')[0] || 'remote-file';
            onFileReady(new File([blob], filename, { type: blob.type }));
        } catch (err) {
            setUrlError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-2">
            {/* Mode toggle */}
            <div className="flex rounded-md border border-slate-200 bg-slate-100 p-0.5 w-fit text-xs">
                <button
                    type="button"
                    onClick={() => switchMode('upload')}
                    className={`px-3 py-1 rounded transition-colors ${
                        mode === 'upload'
                            ? 'bg-white text-sky-700 font-semibold shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    Upload
                </button>
                <button
                    type="button"
                    onClick={() => switchMode('url')}
                    className={`px-3 py-1 rounded transition-colors ${
                        mode === 'url'
                            ? 'bg-white text-sky-700 font-semibold shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    URL
                </button>
            </div>

            {mode === 'upload' ? (
                <>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={handleUploadChange}
                        className="sr-only"
                        id={inputId}
                    />
                    <label
                        htmlFor={inputId}
                        className="block w-full text-sm text-slate-500 border border-slate-300 rounded-md px-3 py-2 cursor-pointer bg-white hover:bg-slate-50 transition-colors"
                    >
                        <span className="inline-flex items-center">
                            <span className="bg-sky-50 text-sky-700 font-semibold px-2 py-1 rounded-md mr-2 hover:bg-sky-100 text-xs">
                                Browse
                            </span>
                            <span className="text-slate-500 text-xs truncate">
                                {selectedFile ? selectedFile.name : 'No file selected'}
                            </span>
                        </span>
                    </label>
                </>
            ) : (
                <>
                    <div className="flex gap-1">
                        <input
                            type="url"
                            value={urlValue}
                            onChange={(e) => setUrlValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
                            placeholder="https://example.com/file.pdf"
                            className="flex-1 min-w-0 text-xs border border-slate-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500"
                        />
                        <button
                            type="button"
                            onClick={handleLoad}
                            disabled={!urlValue.trim() || isLoading}
                            className="text-xs px-3 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                        >
                            {isLoading ? '...' : 'Load'}
                        </button>
                    </div>
                    {selectedFile && (
                        <p className="text-xs text-slate-500 truncate">
                            {selectedFile.name}
                        </p>
                    )}
                    {urlError && (
                        <p className="text-xs text-red-600">{urlError}</p>
                    )}
                </>
            )}
        </div>
    );
};

export default FileOrUrlInput;