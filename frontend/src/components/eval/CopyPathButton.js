import React, { useState, useEffect } from 'react';

const CopyPathButton = ({ path, label, disabled = false }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        if (disabled || !path) return;

        try {
            await navigator.clipboard.writeText(path);
            setCopied(true);
        } catch (err) {
            console.error('Failed to copy path:', err);
        }
    };

    useEffect(() => {
        if (copied) {
            const timer = setTimeout(() => {
                setCopied(false);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [copied]);

    // Reset copied state when path changes
    useEffect(() => {
        setCopied(false);
    }, [path]);

    return (
        <button
            onClick={handleCopy}
            disabled={disabled}
            className={`text-sm font-normal transition-colors ${
                disabled
                    ? 'text-slate-400 cursor-not-allowed'
                    : copied
                    ? 'text-green-600'
                    : 'text-slate-600 hover:text-slate-800 cursor-pointer'
            }`}
        >
            {copied ? '✓' : '📋'} {label}
        </button>
    );
};

const CopyPathButtons = ({ pdfPath, jsonPath, disabled = false }) => {
    const [copiedPdf, setCopiedPdf] = useState(false);
    const [copiedJson, setCopiedJson] = useState(false);

    const handleCopyPdf = async () => {
        if (disabled || !pdfPath) return;

        try {
            await navigator.clipboard.writeText(pdfPath);
            setCopiedPdf(true);
        } catch (err) {
            console.error('Failed to copy PDF path:', err);
        }
    };

    const handleCopyJson = async () => {
        if (disabled || !jsonPath) return;

        try {
            await navigator.clipboard.writeText(jsonPath);
            setCopiedJson(true);
        } catch (err) {
            console.error('Failed to copy JSON path:', err);
        }
    };

    useEffect(() => {
        if (copiedPdf) {
            const timer = setTimeout(() => {
                setCopiedPdf(false);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [copiedPdf]);

    useEffect(() => {
        if (copiedJson) {
            const timer = setTimeout(() => {
                setCopiedJson(false);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [copiedJson]);

    // Reset copied states when paths change
    useEffect(() => {
        setCopiedPdf(false);
        setCopiedJson(false);
    }, [pdfPath, jsonPath]);

    const baseClasses = "text-sm font-normal transition-colors";
    const disabledClasses = "text-slate-400 cursor-not-allowed";
    const activeClasses = "text-slate-600 hover:text-slate-800 cursor-pointer";
    const copiedClasses = "text-green-600";

    return (
        <div className="inline-flex items-center gap-1">
            <button
                onClick={handleCopyPdf}
                disabled={disabled}
                className={`${baseClasses} ${
                    disabled ? disabledClasses : copiedPdf ? copiedClasses : activeClasses
                }`}
            >
                {copiedPdf ? '✓' : '📋'} PDF
            </button>
            <span className={disabled ? 'text-slate-400' : 'text-slate-600'}>|</span>
            <button
                onClick={handleCopyJson}
                disabled={disabled}
                className={`${baseClasses} ${
                    disabled ? disabledClasses : copiedJson ? copiedClasses : activeClasses
                }`}
            >
                {copiedJson ? '✓' : ''} JSON
            </button>
        </div>
    );
};

export { CopyPathButton, CopyPathButtons };