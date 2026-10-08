import React from 'react';

/**
 * LineAnnotator
 *
 * Pure UI component — renders raw Tesseract OCR lines (page_NNNN.json's
 * `lines` array) annotated with the real classifier's per-line diagnostics:
 * is_indented / is_centered (verse) and the left/right gap as a % of the
 * page's prose width. Used by ParagraphGenEval (JSON view) for
 * ocr_engine=tesseract pages, as the sibling of BlockAnnotator (which
 * handles the ocr_engine=llm block-typed JSON shape instead).
 *
 * Props:
 *   lines          — array of { line_num, text, x_start, x_end }, the raw OCR line data
 *   classifications — array of { line_num, is_indented, is_centered, left_pct, right_pct },
 *                     same length/order as lines, or null while loading
 *   error          — string, set if the classify-lines call failed
 */
const LineAnnotator = ({ lines, classifications, error }) => {
    if (!lines || lines.length === 0) {
        return (
            <div className="text-slate-400 text-sm text-center py-12">
                No lines found for this page.
            </div>
        );
    }

    const classByLineNum = new Map((classifications || []).map(c => [c.line_num, c]));

    return (
        <div className="space-y-2 overflow-y-auto max-h-[720px] pr-1">
            {error && (
                <div className="px-3 py-2 rounded text-sm bg-red-50 border border-red-200 text-red-800">
                    {error}
                </div>
            )}
            {lines.map((line, idx) => {
                const cls = classByLineNum.get(line.line_num);
                const isVerse = !!cls?.is_centered;
                const isIndented = !!cls?.is_indented;
                return (
                    <div
                        key={idx}
                        className={`rounded-lg p-2.5 border ${
                            isVerse
                                ? 'border-emerald-200'
                                : isIndented
                                    ? 'border-sky-200'
                                    : 'border-slate-200'
                        }`}
                        style={{ backgroundColor: 'var(--bg-surface)' }}
                    >
                        <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap font-mono">
                            {line.text || <span className="italic text-slate-400">(empty)</span>}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-200/70">
                            {isVerse && (
                                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                                    Verse
                                </span>
                            )}
                            {!isVerse && isIndented && (
                                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-sky-100 text-sky-800 border border-sky-300">
                                    Indented
                                </span>
                            )}
                            {cls ? (
                                <span className="text-xs text-slate-400 font-mono ml-auto">
                                    L {cls.left_pct.toFixed(1)}% · R {cls.right_pct.toFixed(1)}%
                                </span>
                            ) : (
                                <span className="text-xs text-slate-400 italic ml-auto">…</span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default LineAnnotator;
