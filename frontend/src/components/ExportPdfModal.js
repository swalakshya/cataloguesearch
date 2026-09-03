import React, { useState } from 'react';
import { Modal, Button } from './ui';
import { api } from '../services/api';
import { DownloadIcon } from './SharedComponents';

const COUNT_OPTIONS = [10, 20, 50];

// exportParams carries the same query/filters as the currently active search
// (see buildSearchPayload in App.js) plus `category` — the count picked here is
// the only thing this modal adds before calling api.exportPdf.
const ExportPdfModal = ({ exportParams, onClose }) => {
    const [count, setCount] = useState(20);
    const [isExporting, setIsExporting] = useState(false);
    const [error, setError] = useState('');

    const handleExport = async () => {
        setIsExporting(true);
        setError('');
        try {
            const { blob, filename } = await api.exportPdf({ ...exportParams, count });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            onClose();
        } catch (err) {
            console.error('Export PDF failed:', err);
            setError('Could not export PDF. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <Modal open onClose={onClose} title={`Export ${exportParams.category} to PDF`} size="sm">
            <div className="text-sm text-ink-muted mb-3">
                How many results would you like to export? Results start from the first page.
            </div>
            <div className="flex gap-2 mb-4">
                {COUNT_OPTIONS.map((option) => (
                    <button
                        key={option}
                        onClick={() => setCount(option)}
                        disabled={isExporting}
                        className="flex-1 py-2 rounded border text-sm font-medium transition-colors"
                        style={
                            count === option
                                ? { borderColor: 'var(--color-brand)', backgroundColor: 'var(--color-brand)', color: '#fff' }
                                : { borderColor: 'var(--color-border)', color: 'var(--color-ink)' }
                        }
                    >
                        {option}
                    </button>
                ))}
            </div>

            {error && <div className="text-sm text-danger mb-3">{error}</div>}

            <Button onClick={handleExport} disabled={isExporting} className="w-full">
                <DownloadIcon />
                {isExporting ? 'Generating PDF…' : 'Export PDF'}
            </Button>
        </Modal>
    );
};

export default ExportPdfModal;
