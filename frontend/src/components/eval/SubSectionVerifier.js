import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

// View-only check of a scan_config's sub-sections: the START page and the END page of each one, side by side.
// Nothing here is saved or marked; it is for looking. Config page numbers are physical PDF pages (also for
// two-page-spread books, where start_side / end_side say which half of the boundary page belongs to the section).

const RENDER_SCALE = 1.5;
const CACHE_LIMIT = 24;
const RANDOM_COUNT = 10;

// pdf.js page -> JPEG data URL. Injected into the component so tests don't need a real canvas.
export async function renderPdfPage(pdfDoc, pageNumber) {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.85);
}

// k distinct indexes out of n, in page order (partial Fisher-Yates).
export function pickRandom(n, k = RANDOM_COUNT, rand = Math.random) {
    const idx = Array.from({ length: n }, (_, i) => i);
    const count = Math.min(k, n);
    for (let i = 0; i < count; i += 1) {
        const j = i + Math.floor(rand() * (n - i));
        [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx.slice(0, count).sort((a, b) => a - b);
}

// Previous / next member of `set` (sorted indexes) around `current`, which need not be in the set itself.
export function neighbours(set, current) {
    let prev;
    let next;
    for (const i of set) {
        if (i < current) prev = i;
        if (i > current && next === undefined) next = i;
    }
    return { prev, next };
}

const pageLabel = (n) => (Number.isInteger(n) ? `p.${n}` : 'no page set');

function PagePane({ title, pageNumber, sectionLabel, getImage, totalPages, crop, showCrop, dimSide }) {
    const [state, setState] = useState({ status: 'loading', url: null });

    useEffect(() => {
        let alive = true;
        if (!Number.isInteger(pageNumber)) { setState({ status: 'none', url: null }); return undefined; }
        if (totalPages && (pageNumber < 1 || pageNumber > totalPages)) { setState({ status: 'range', url: null }); return undefined; }
        setState({ status: 'loading', url: null });
        getImage(pageNumber)
            .then((url) => { if (alive) setState({ status: 'ready', url }); })
            .catch(() => { if (alive) setState({ status: 'error', url: null }); });
        return () => { alive = false; };
    }, [pageNumber, getImage, totalPages]);

    const band = 'absolute bg-red-500/15 border-red-400 border-dashed pointer-events-none';
    return (
        <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-baseline justify-between px-1 pb-1">
                <span className="text-sm font-semibold text-slate-800">{title} <span className="font-mono">{pageLabel(pageNumber)}</span></span>
                <span className="text-xs text-slate-500 truncate ml-2" title={sectionLabel}>{sectionLabel}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-slate-100 rounded border border-slate-200 flex items-start justify-center p-2">
                {state.status === 'ready' && (
                    <div className="relative inline-block leading-none" data-testid={`pane-${title.toLowerCase()}`}>
                        <img src={state.url} alt={`${title} page ${pageNumber}`}
                            style={{ maxHeight: 'calc(100vh - 11rem)', maxWidth: '100%', width: 'auto', height: 'auto' }} className="block bg-white shadow" />
                        {showCrop && crop && (
                            <>
                                {crop.top > 0 && <div className={`${band} left-0 right-0 top-0 border-b`} style={{ height: `${crop.top}%` }} data-testid="crop-band" />}
                                {crop.bottom > 0 && <div className={`${band} left-0 right-0 bottom-0 border-t`} style={{ height: `${crop.bottom}%` }} data-testid="crop-band" />}
                                {crop.left > 0 && <div className={`${band} top-0 bottom-0 left-0 border-r`} style={{ width: `${crop.left}%` }} data-testid="crop-band" />}
                                {crop.right > 0 && <div className={`${band} top-0 bottom-0 right-0 border-l`} style={{ width: `${crop.right}%` }} data-testid="crop-band" />}
                            </>
                        )}
                        {dimSide && (
                            <div className={`absolute top-0 bottom-0 w-1/2 bg-slate-900/40 pointer-events-none flex items-center justify-center ${dimSide === 'left' ? 'left-0' : 'right-0'}`} data-testid="dim-side">
                                <span className="text-xs text-white bg-slate-900/70 rounded px-2 py-0.5">not in this section</span>
                            </div>
                        )}
                    </div>
                )}
                {state.status === 'loading' && <span className="text-sm text-slate-400 self-center">Rendering…</span>}
                {state.status === 'none' && <span className="text-sm text-slate-400 self-center">This sub-section has no {title.toLowerCase()} page.</span>}
                {state.status === 'range' && <span className="text-sm text-amber-700 self-center">Page {pageNumber} is outside this PDF ({totalPages} pages).</span>}
                {state.status === 'error' && <span className="text-sm text-red-600 self-center">Could not render page {pageNumber}.</span>}
            </div>
        </div>
    );
}

export default function SubSectionVerifier({ pdfDoc, subSections, crop, multiPage, fileName, onClose, renderPageImage = renderPdfPage }) {
    const [current, setCurrent] = useState(0);
    const [mode, setMode] = useState('all'); // 'all' | 'selected' | 'random'
    const [selected, setSelected] = useState(() => new Set());
    const [randomSet, setRandomSet] = useState([]);
    const [filter, setFilter] = useState('');
    const [showCrop, setShowCrop] = useState(true);
    const cacheRef = useRef({ doc: null, pages: new Map() }); // page number -> Promise<url>, oldest evicted first; per PDF

    const total = subSections.length;
    const totalPages = pdfDoc?.numPages || 0;

    const getImage = useCallback((pageNumber) => {
        if (cacheRef.current.doc !== pdfDoc) cacheRef.current = { doc: pdfDoc, pages: new Map() }; // never serve another PDF's pages
        const cache = cacheRef.current.pages;
        if (!cache.has(pageNumber)) {
            const p = Promise.resolve(renderPageImage(pdfDoc, pageNumber));
            p.catch(() => cache.delete(pageNumber)); // don't cache failures
            cache.set(pageNumber, p);
            if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
        }
        return cache.get(pageNumber);
    }, [pdfDoc, renderPageImage]);

    const navSet = useMemo(() => {
        if (mode === 'selected') return [...selected].sort((a, b) => a - b);
        if (mode === 'random') return randomSet;
        return Array.from({ length: total }, (_, i) => i);
    }, [mode, selected, randomSet, total]);

    const { prev, next } = neighbours(navSet, current);
    const position = navSet.indexOf(current);
    const sub = subSections[current] || {};

    const go = useCallback((i) => { if (i !== undefined) setCurrent(i); }, []);

    // Warm the cache for the next section's pages so stepping with the arrow keys feels instant.
    useEffect(() => {
        if (next === undefined) return;
        [subSections[next].start_page, subSections[next].end_page].forEach((p) => {
            if (Number.isInteger(p) && (!totalPages || (p >= 1 && p <= totalPages))) getImage(p).catch(() => {});
        });
    }, [next, subSections, totalPages, getImage]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') { onClose(); return; }
            const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.target.type !== 'checkbox';
            if (typing) return; // arrow keys belong to the filter box while it has focus
            if (e.key === 'ArrowRight') { e.preventDefault(); go(next); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); go(prev); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [next, prev, go, onClose]);

    const chooseMode = (m) => {
        setMode(m);
        const set = m === 'selected' ? [...selected].sort((a, b) => a - b) : m === 'random' ? randomSet : null;
        if (set && set.length && !set.includes(current)) setCurrent(set[0]);
    };

    const rollRandom = () => {
        const picked = pickRandom(total, RANDOM_COUNT);
        setRandomSet(picked);
        setMode('random');
        if (picked.length) setCurrent(picked[0]);
    };

    const toggle = (i) => setSelected((cur) => {
        const s = new Set(cur);
        if (s.has(i)) s.delete(i); else s.add(i);
        return s;
    });

    const rows = subSections
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => !filter || `${s.field || ''} ${s.name || ''}`.toLowerCase().includes(filter.toLowerCase()));

    const range = (s) => `${s.start_page ?? '?'}–${s.end_page ?? '?'}`;
    const count = Number.isInteger(sub.start_page) && Number.isInteger(sub.end_page) ? sub.end_page - sub.start_page + 1 : null;
    const label = `${sub.field ? `${sub.field} · ` : ''}${sub.name || `#${current + 1}`}`;
    const chip = (active) => `cursor-pointer text-xs px-2.5 py-1 rounded border ${active ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 p-3" role="dialog" aria-modal="true" aria-label="Verify sub-sections">
            <div className="h-full bg-white rounded-lg shadow-xl flex flex-col overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-slate-200">
                    <h2 className="text-base font-semibold text-slate-800">Verify sub-sections</h2>
                    <span className="text-xs text-slate-500 truncate max-w-[16rem]" title={fileName}>{fileName}</span>
                    <div className="flex items-center gap-1.5 ml-2">
                        <button className={chip(mode === 'all')} onClick={() => chooseMode('all')}>All ({total})</button>
                        <button className={`${chip(mode === 'selected')} disabled:opacity-40 disabled:cursor-not-allowed`} disabled={selected.size === 0}
                            onClick={() => chooseMode('selected')}>Selected ({selected.size})</button>
                        <button className={chip(mode === 'random')} onClick={rollRandom}>Random {Math.min(RANDOM_COUNT, total)} ↻</button>
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                        <span className="text-xs text-slate-500" data-testid="position">
                            {position >= 0 ? `${position + 1} of ${navSet.length}` : `not in this set`}
                        </span>
                        <button className={`${chip(false)} disabled:opacity-40 disabled:cursor-not-allowed`} disabled={prev === undefined} onClick={() => go(prev)} title="Previous (←)">← Prev</button>
                        <button className={`${chip(false)} disabled:opacity-40 disabled:cursor-not-allowed`} disabled={next === undefined} onClick={() => go(next)} title="Next (→)">Next →</button>
                        {!multiPage && crop && Object.values(crop).some((v) => v > 0) && (
                            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer" title="Faint red bands mark what the scan_config crops away">
                                <input type="checkbox" checked={showCrop} onChange={(e) => setShowCrop(e.target.checked)} /> Show crop
                            </label>
                        )}
                        <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 text-xl leading-none px-1" aria-label="Close">×</button>
                    </div>
                </div>

                <div className="flex-1 min-h-0 flex">
                    <div className="w-72 shrink-0 border-r border-slate-200 flex flex-col">
                        <div className="p-2 border-b border-slate-100 space-y-1.5">
                            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter sub-sections…"
                                className="w-full text-xs px-2 py-1.5 border border-slate-300 rounded" />
                            <div className="flex justify-between text-xs">
                                <button className="cursor-pointer text-blue-600 hover:underline"
                                    onClick={() => setSelected((cur) => new Set([...cur, ...rows.map(({ i }) => i)]))}>Select shown</button>
                                <button className="cursor-pointer text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                                    disabled={selected.size === 0} onClick={() => setSelected(new Set())}>Clear</button>
                            </div>
                        </div>
                        <ul className="flex-1 overflow-auto" data-testid="rail">
                            {rows.map(({ s, i }) => (
                                <li key={i} onClick={() => go(i)} data-current={i === current}
                                    className={`flex items-start gap-2 px-2 py-1.5 cursor-pointer border-b border-slate-50 ${i === current ? 'bg-sky-50 border-l-2 border-l-sky-500' : 'hover:bg-slate-50'}`}>
                                    <input type="checkbox" className="mt-0.5" checked={selected.has(i)} onChange={() => toggle(i)} onClick={(e) => e.stopPropagation()}
                                        aria-label={`Select ${s.name || `#${i + 1}`}`} />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs text-slate-800 truncate" title={s.name}>{s.name || `#${i + 1}`}</div>
                                        <div className="text-[11px] text-slate-500 font-mono">{range(s)}{s.field ? <span className="font-sans"> · {s.field}</span> : null}</div>
                                    </div>
                                    {mode !== 'all' && navSet.includes(i) && <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-sky-500 shrink-0" title="In this set" />}
                                </li>
                            ))}
                            {rows.length === 0 && <li className="p-3 text-xs text-slate-400">Nothing matches.</li>}
                        </ul>
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col p-3 gap-2">
                        <div className="text-sm text-slate-700">
                            <span className="font-medium" data-testid="section-label">{label}</span>
                            <span className="text-slate-500"> · pages {range(sub)}{count !== null ? ` (${count} page${count === 1 ? '' : 's'})` : ''}</span>
                        </div>
                        <div className="flex-1 min-h-0 flex gap-3">
                            <PagePane title="Start" pageNumber={sub.start_page} sectionLabel={sub.start_side ? `${sub.start_side} half` : ''}
                                getImage={getImage} totalPages={totalPages} crop={multiPage ? null : crop} showCrop={showCrop}
                                dimSide={sub.start_side === 'right' ? 'left' : null} />
                            <PagePane title="End" pageNumber={sub.end_page} sectionLabel={sub.end_side ? `${sub.end_side} half` : ''}
                                getImage={getImage} totalPages={totalPages} crop={multiPage ? null : crop} showCrop={showCrop}
                                dimSide={sub.end_side === 'left' ? 'right' : null} />
                        </div>
                        <div className="text-xs text-slate-400">← → step through {mode === 'all' ? 'all sub-sections' : mode === 'selected' ? 'the selected ones' : 'the random set'} · Esc closes</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
