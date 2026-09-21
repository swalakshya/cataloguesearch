import React, { useRef, useState } from 'react';
import { useOutsideClick } from '../../hooks/useOutsideClick';

// The slim bar at the top of Eval: tool tabs on the left; the current file, the paths and Full screen on the right.
// It replaces the old title, the two-line tab buttons and the always-open paths block (about 200px of height).

export const PRIMARY_TABS = [
    { id: 'home', label: 'Home' },
    { id: 'pdf-parser', label: 'PDF Parser' },
    { id: 'ocr-preview', label: 'OCR Preview' },
    { id: 'paragraph-eval', label: 'Gen Eval' },
    { id: 'paragraph-classifier', label: 'Classifier' },
];
export const MORE_TABS = [
    { id: 'unindexed-pdfs', label: 'Unindexed PDFs' },
    { id: 'bookmark-backfill', label: 'Bookmark Backfill' },
    { id: 'load-test', label: 'Load Test' },
];

const tabClass = (active) => `cursor-pointer h-full px-3 text-sm whitespace-nowrap border-b-2 transition-colors ${
    active ? 'border-sky-600 text-sky-700 font-medium' : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`;

function MoreMenu({ activeTab, onTab }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useOutsideClick(ref, () => setOpen(false), { enabled: open });
    const current = MORE_TABS.find((t) => t.id === activeTab);
    return (
        <div ref={ref} className="relative h-full">
            <button className={tabClass(!!current)} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
                {current ? current.label : 'More'} <span className="text-[10px]">▾</span>
            </button>
            {open && (
                <div role="menu" data-esc-owner className="absolute left-0 top-full mt-0.5 z-30 min-w-[11rem] rounded-md border border-slate-200 bg-white shadow-lg py-1">
                    {MORE_TABS.map((t) => (
                        <button key={t.id} role="menuitem" onClick={() => { onTab(t.id); setOpen(false); }}
                            className={`cursor-pointer w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 ${activeTab === t.id ? 'text-sky-700 font-medium' : 'text-slate-700'}`}>
                            {t.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function PathsPopover({ basePaths }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useOutsideClick(ref, () => setOpen(false), { enabled: open });
    if (!basePaths) return null;
    const rows = [['Base PDF', basePaths.base_pdf_path], ['OCR', basePaths.base_ocr_path], ['Text', basePaths.base_text_path]];
    return (
        <div ref={ref} className="relative">
            <button onClick={() => setOpen((o) => !o)} aria-label="Paths" aria-expanded={open} title="Where the PDFs, OCR and text live"
                className="cursor-pointer h-8 w-8 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm">ⓘ</button>
            {open && (
                <div role="dialog" aria-label="Paths" data-esc-owner
                    className="absolute right-0 top-full mt-1 z-30 w-[34rem] max-w-[90vw] rounded-md border border-slate-200 bg-white shadow-lg p-3 space-y-2">
                    {rows.map(([label, value]) => (
                        <div key={label}>
                            <div className="text-xs font-medium text-slate-500">{label}</div>
                            <div className="font-mono text-xs text-slate-700 break-all select-all">{value}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function EvalBar({ activeTab, onTab, fileLabel, canBrowse, onBrowse, basePaths, focus, onToggleFocus }) {
    const btn = 'cursor-pointer h-8 px-3 rounded-md border text-sm whitespace-nowrap';
    return (
        <div className="shrink-0 flex items-stretch gap-2 h-10 px-3 border-b border-slate-200" style={{ backgroundColor: 'var(--bg-card)' }} data-testid="eval-bar">
            <nav className="flex items-stretch overflow-x-auto" aria-label="Eval tools">
                {PRIMARY_TABS.map((t) => (
                    <button key={t.id} className={tabClass(activeTab === t.id)} aria-current={activeTab === t.id ? 'page' : undefined} onClick={() => onTab(t.id)}>{t.label}</button>
                ))}
                <MoreMenu activeTab={activeTab} onTab={onTab} />
            </nav>
            <div className="ml-auto flex items-center gap-2">
                {canBrowse && (
                    <button onClick={onBrowse} title="Choose a file (Browse Files)"
                        className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50 max-w-[22rem] truncate`} data-testid="file-chip">
                        <span aria-hidden="true">📄</span> {fileLabel || 'Browse files…'} <span className="text-[10px]">▾</span>
                    </button>
                )}
                <PathsPopover basePaths={basePaths} />
                <button onClick={onToggleFocus} aria-pressed={focus}
                    title={focus ? 'Bring the Dev bar back (Esc)' : 'Hide the Dev bar for more room'}
                    className={`${btn} ${focus ? 'border-sky-600 bg-sky-600 text-white hover:bg-sky-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                    {focus ? '⤡ Exit full screen' : '⤢ Full screen'}
                </button>
            </div>
        </div>
    );
}
