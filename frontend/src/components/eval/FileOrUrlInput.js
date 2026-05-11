import React, { useState, useRef } from 'react';

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

const LANGS = [
    { value: 'hin', label: 'हिंदी' },
    { value: 'guj', label: 'ગુજરાતી' },
];

/**
 * URL/Upload toggle with embedded language selector and action button.
 * Calls onFileReady(File) in both modes.
 * Language state is controlled via `language` + `onLanguageChange` props.
 */
const FileOrUrlInput = ({
    onFileReady,
    selectedFile,
    inputId = 'file-or-url-input',
    language = 'hin',
    onLanguageChange,
}) => {
    const [mode, setMode] = useState('url');
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
            const filename = trimmed.split('/').pop().split('?')[0] || 'remote-file';
            onFileReady(new File([blob], filename, { type: blob.type }));
        } catch (err) {
            setUrlError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const isGuj = language === 'guj' || language === 'guj+hin';
    const hasHindi = language === 'guj+hin';

    const LangToggle = () => (
        <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center rounded border border-slate-200 bg-slate-100 p-0.5">
                {LANGS.map(({ value, label }) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => onLanguageChange?.(value)}
                        className={`px-2 py-0.5 rounded text-xs transition-colors ${
                            (value === 'guj' ? isGuj : language === value)
                                ? 'bg-white text-sky-700 font-semibold shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>
            {isGuj && (
                <label className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={hasHindi}
                        onChange={e => onLanguageChange?.(e.target.checked ? 'guj+hin' : 'guj')}
                        className="accent-sky-600"
                    />
                    <span>+ हिंदी</span>
                </label>
            )}
        </div>
    );

    return (
        <div className="space-y-1.5 w-[600px] max-w-full">
            {/* Mode toggle */}
            <div className="flex rounded-md border border-slate-200 bg-slate-100 p-0.5 w-fit text-xs">
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
            </div>

            {/* Input bar */}
            {mode === 'url' ? (
                <>
                    <div className="flex items-center gap-2 border border-slate-300 rounded-lg bg-white px-3 focus-within:ring-1 focus-within:ring-sky-500 focus-within:border-sky-500">
                        <input
                            type="url"
                            value={urlValue}
                            onChange={(e) => setUrlValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
                            placeholder="https://example.com/file.pdf"
                            className="flex-1 min-w-0 text-xs py-2 outline-none bg-transparent"
                        />
                        <LangToggle />
                        <button
                            type="button"
                            onClick={handleLoad}
                            disabled={!urlValue.trim() || isLoading}
                            title="Load"
                            className="shrink-0 text-base text-slate-400 hover:text-sky-600 disabled:text-slate-300 disabled:cursor-not-allowed transition-colors leading-none"
                        >
                            {isLoading ? '…' : '↵'}
                        </button>
                    </div>
                    {urlError && (
                        <p className="text-xs text-red-600">{urlError}</p>
                    )}
                </>
            ) : (
                <>
                    <div className="flex items-center gap-2 border border-slate-300 rounded-lg bg-white px-3">
                        <span className="flex-1 min-w-0 text-xs py-2 text-slate-400 truncate">
                            {selectedFile ? selectedFile.name : 'No file selected'}
                        </span>
                        <LangToggle />
                        <label
                            htmlFor={inputId}
                            className="shrink-0 text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded cursor-pointer transition-colors whitespace-nowrap"
                        >
                            Browse
                        </label>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={handleUploadChange}
                            className="sr-only"
                            id={inputId}
                        />
                    </div>
                </>
            )}
        </div>
    );
};

export default FileOrUrlInput;
