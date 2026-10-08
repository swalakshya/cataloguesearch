import React from 'react';
import { TYPE_COLOURS, TYPE_ABBR } from './classifierConstants';

/**
 * BlockAnnotator
 *
 * Pure UI component — renders a list of OCR blocks with inline type selectors.
 * Used by both ParaClassifier and ParagraphGenEval (JSON view).
 *
 * Props:
 *   blocks        — array of { type, text }
 *   originalTypes — array of original type strings (same length as blocks)
 *   blockTypes    — array of all valid type strings
 *   onReclassify  — (blockIndex, newType) => void
 */
const BlockAnnotator = ({ blocks, originalTypes, blockTypes, onReclassify }) => {
    if (!blocks || blocks.length === 0) {
        return (
            <div className="text-slate-400 text-sm text-center py-12">
                No blocks found for this page.
            </div>
        );
    }

    return (
        <div className="space-y-3 overflow-y-auto max-h-[720px] pr-1">
            {blocks.map((block, idx) => {
                const isEdited = block.type !== originalTypes[idx];
                const originalType = originalTypes[idx];
                return (
                    <div
                        key={idx}
                        className={`rounded-lg p-3 border ${
                            isEdited
                                ? 'border-slate-200 border-l-4 border-l-amber-400'
                                : 'border-slate-200'
                        }`}
                        style={{ backgroundColor: 'var(--bg-surface)' }}
                    >
                        <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap font-mono mb-2">
                            {block.text}
                        </p>
                        {/* Type selector row */}
                        <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-slate-200">
                            {/* 1. Current type — always first, full text + colour */}
                            <button
                                onClick={() => onReclassify(idx, block.type)}
                                title={block.type}
                                className={`px-2 py-0.5 text-xs border rounded-full transition-colors font-semibold ring-1 ring-offset-1 ring-current ${
                                    TYPE_COLOURS[block.type] || 'bg-slate-100 text-slate-700 border-slate-300'
                                }`}
                            >
                                {block.type}
                            </button>

                            {/* 2. Original type — grey, full text, only when edited; click to restore */}
                            {isEdited && (
                                <button
                                    onClick={() => onReclassify(idx, originalType)}
                                    title={`Restore: ${originalType}`}
                                    className="px-2 py-0.5 text-xs border rounded-full bg-slate-100 text-slate-400 border-slate-300 hover:bg-slate-200 transition-colors"
                                >
                                    {originalType}
                                </button>
                            )}

                            {/* 3. Remaining types as initials, excluding current */}
                            {blockTypes.filter(t => t !== block.type).map(t => (
                                <button
                                    key={t}
                                    onClick={() => onReclassify(idx, t)}
                                    title={t}
                                    className={`px-2 py-0.5 text-xs border rounded-full transition-colors ${
                                        TYPE_COLOURS[t] || 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                                    }`}
                                >
                                    {TYPE_ABBR[t] || t}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default BlockAnnotator;
