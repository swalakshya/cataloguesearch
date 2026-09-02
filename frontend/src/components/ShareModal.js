import React, { useState, useEffect } from 'react';
import { Copy } from 'lucide-react';
import { Modal, Button } from './ui';
import {
    generateShareURL,
    formatShareContent,
    copyToClipboard,
    trackShareEvent
} from '../utils/shareUtils';

const DetailRow = ({ label, children }) => (
    <div className="text-sm text-ink mb-2">
        <strong>{label}:</strong> {children}
    </div>
);

const ShareModal = ({ result, query, currentFilters, language, searchType, onClose }) => {
    const [shareData, setShareData] = useState({});
    const [copiedFeedback, setCopiedFeedback] = useState('');

    useEffect(() => {
        const url = generateShareURL();
        const data = formatShareContent(query, result, url, language);

        setShareData(data);

    }, [result, query, language]);

    const handleCopyText = async () => {
        const success = await copyToClipboard(shareData.text);
        if (success) {
            setCopiedFeedback('Text copied to clipboard!');
            trackShareEvent('copy_text', query, result.document_id);
            setTimeout(() => setCopiedFeedback(''), 3000);
        } else {
            setCopiedFeedback('Failed to copy text');
            setTimeout(() => setCopiedFeedback(''), 3000);
        }
    };

    return (
        <Modal open onClose={onClose} title="Share Result" size="sm">
            <div className="card p-4 mb-4" style={{ backgroundColor: 'var(--color-bg)' }}>
                <div className="text-sm text-ink-muted mb-2">
                    <strong>Query:</strong> "{query}"
                </div>
                <div className="text-sm text-ink mb-2 italic whitespace-pre-line">
                    <strong>Extract:</strong> "{result?.content_snippet ? result.content_snippet.replace(/<[^>]*>/g, '').trim() : 'Loading...'}"
                </div>

                {shareData.isGranth ? (
                    // Granth result display
                    <>
                        <DetailRow label="Granth">{shareData.granthName || 'Unknown Granth'}</DetailRow>
                        {shareData.subSection && (
                            <DetailRow label={shareData.subSection.field}>{shareData.subSection.name}</DetailRow>
                        )}
                        {shareData.author && (
                            <DetailRow label="Author">{shareData.author}</DetailRow>
                        )}
                        {shareData.tikakaar && (
                            <DetailRow label="Tikakaar">{shareData.tikakaar}</DetailRow>
                        )}
                        {shareData.locationInfo && (
                            <div className="text-sm text-ink">
                                <strong>Location:</strong> {shareData.locationInfo}
                            </div>
                        )}
                    </>
                ) : (
                    // Pravachan result display
                    <>
                        <DetailRow label="Granth">{shareData.granth || 'Unknown Source'}</DetailRow>
                        <DetailRow label={shareData.pravachankarLabel || (language === 'gujarati' ? 'પ્રવચનકાર:' : 'प्रवचनकार:')}>{shareData.pravachankar || 'Unknown'}</DetailRow>
                        <div className="text-sm text-ink">
                            <strong>Pravachan Details:</strong> {shareData.pravachanDetails || 'Unknown'}
                        </div>
                    </>
                )}
            </div>

            {copiedFeedback && (
                <div className="badge badge-success mb-4" style={{ display: 'flex', width: 'fit-content' }}>
                    {copiedFeedback}
                </div>
            )}

            <Button onClick={handleCopyText} className="w-full">
                <Copy size={18} />
                Copy Text
            </Button>
        </Modal>
    );
};

export default ShareModal;
