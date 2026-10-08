import React, { useState } from 'react';
import { Check } from 'lucide-react';
import clipboardEmoji from '../../assets/emoji/clipboard.svg';
import { copyToClipboard } from '../../utils/shareUtils';
import { parseCitationAttrs, buildCitationLabel, stripSummaryReferenceMarkers } from './answerFormatting';

// Splits "> quote (citation)" into "> quote\n> (citation)" so WhatsApp keeps the
// citation inside the same quote block but on its own line (every line needs its own ">").
const splitCitationLines = (text) => {
    if (!text) return text;
    return text.replace(/^>[ \t]*(?=\S)([^\n]+?)[ \t]*(\([^)]+\))[ \t]*$/gm, (match, quote, citation) => `> ${quote}\n> ${citation}`);
};

// Resolves @@CITATION_n@@ tokens (from citationBlocks, used when ENABLE_FULL_CHUNKS_IN_CITATIONS
// is on) into WhatsApp-style ">" quote lines — every line of the quote text gets its own ">",
// plus a trailing "> (label)" citation line.
const resolveCitationTokensToText = (text, citationBlocks) => {
    if (!text || !citationBlocks || !citationBlocks.length) return text;
    return text.replace(/@@CITATION_(\d+)@@/g, (match, idx) => {
        const block = citationBlocks[Number(idx)];
        if (!block) return '';
        const attrs = parseCitationAttrs(block.attrStr);
        const label = buildCitationLabel(attrs);
        const quoteLines = block.innerText.trim().split(/\r?\n/)
            .filter(line => line.trim() !== '')
            .map(line => `> ${line}`);
        if (label) quoteLines.push(`> (${label})`);
        return quoteLines.join('\n');
    });
};

const SHARE_FOOTER = '--\n*Get your Adhyatmic questions answered on Swalakshya:* https://chat.swalakshya.me/';

export const ShareAnswerButtons = ({ question, answer, citationBlocks }) => {
    const [copied, setCopied] = useState(false);
    const resolvedAnswer = resolveCitationTokensToText(stripSummaryReferenceMarkers(answer), citationBlocks);
    const formattedAnswer = splitCitationLines(resolvedAnswer);
    const shareText = `${question ? `*Question: ${question}*\n\n*Answer:*\n${formattedAnswer}` : formattedAnswer}\n\n${SHARE_FOOTER}`;

    const handleCopy = async () => {
        const success = await copyToClipboard(shareText);
        if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleWhatsAppShare = () => {
        const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={handleCopy}
                className="btn btn-secondary flex items-center gap-1.5 text-xs py-1 px-2"
                title="Copy answer"
            >
                {copied ? (
                    <>
                        <Check size={14} style={{ color: 'var(--color-success)' }} />
                        <span style={{ color: 'var(--color-success)' }}>Copied to clipboard</span>
                    </>
                ) : (
                    <>
                        <img src={clipboardEmoji} alt="" className="w-3.5 h-3.5" />
                        <span>Copy</span>
                    </>
                )}
            </button>
            <button
                onClick={handleWhatsAppShare}
                className="btn btn-secondary flex items-center gap-1.5 text-xs py-1 px-2"
                title="Share on WhatsApp"
            >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="#25D366">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12.001 2C6.478 2 2 6.478 2 12c0 1.892.526 3.66 1.438 5.166L2 22l4.955-1.4A9.94 9.94 0 0012.001 22C17.523 22 22 17.522 22 12S17.523 2 12.001 2zm0 18.2a8.19 8.19 0 01-4.19-1.147l-.3-.178-3.11.878.83-3.03-.196-.31A8.176 8.176 0 013.8 12c0-4.522 3.679-8.2 8.201-8.2 4.521 0 8.199 3.678 8.199 8.2 0 4.522-3.678 8.2-8.199 8.2z"/>
                </svg>
                <span>WhatsApp</span>
            </button>
        </div>
    );
};

export default ShareAnswerButtons;
