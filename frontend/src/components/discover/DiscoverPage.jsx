import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    api, postJson, timeAgo, Card, PageShell, ErrorBanner, ConfirmModal,
    useJobs, BusyNotice, RunPanel, JobHistory,
} from '../dev/JobUI';
import { useDevShell, DockerBlockedNotice } from '../dev/DevShell';

const STATUS = {
    not_indexed: { label: 'Not indexed', className: 'bg-red-100 text-red-800' },
    ocred: { label: 'OCRed', className: 'bg-yellow-100 text-yellow-800' },
    indexed: { label: 'Indexed', className: 'bg-green-100 text-green-800' },
};

function Pill({ status, count }) {
    const cfg = STATUS[status];
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.className}`}>
            {cfg.label}<span className="font-semibold">{count}</span>
        </span>
    );
}

// Open the file straight in an Eval tool. PDF Parser works on the PDF itself (it OCRs a page on demand and picks up
// the file's scan_config), so it is offered for every file, including ones not OCRed yet. Paragraph Eval compares
// against OCR output, so it only appears once that exists (OCRed or Indexed).
function EvalLinks({ file }) {
    const q = encodeURIComponent(file.relative_path);
    const cls = 'px-1.5 py-0.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 hover:text-blue-700 cursor-pointer';
    return (
        <span className="flex gap-1.5">
            <a className={cls} href={`/eval?tab=pdf-parser&file=${q}`} target="_blank" rel="noreferrer" title="Open in PDF Parser">PDF Parser ↗</a>
            {file.status !== 'not_indexed' && (
                <a className={cls} href={`/eval?tab=paragraph-eval&file=${q}`} target="_blank" rel="noreferrer" title="Open in Paragraph Gen Eval">Paragraph Eval ↗</a>
            )}
        </span>
    );
}

function FileRow({ file }) {
    const cfg = STATUS[file.status];
    const pendingSubs = (file.sub_sections || []).filter((s) => s.status !== 'indexed');
    return (
        <div className="py-1.5 text-xs">
            <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded font-medium ${cfg.className}`}>{cfg.label}</span>
                <span className="text-slate-700 truncate flex-1" title={file.relative_path}>{file.filename}</span>
                {file.batch && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200" title={`${file.batch.job} · ${file.batch.model || ''}`}>
                        LLM batch submitted {timeAgo(file.batch.submitted_at)}
                    </span>
                )}
                {file.last_indexed && <span className="text-slate-400">indexed {timeAgo(file.last_indexed)}</span>}
                <EvalLinks file={file} />
            </div>
            {pendingSubs.length > 0 && (
                <div className="pl-4 mt-1 text-slate-500">
                    {pendingSubs.length} of {file.sub_sections.length} sub-sections pending:{' '}
                    {pendingSubs.slice(0, 6).map((s) => s.name).join(', ')}{pendingSubs.length > 6 ? '…' : ''}
                </div>
            )}
        </div>
    );
}

function ActionButton({ children, onClick, disabled, title, tone = 'blue' }) {
    const tones = {
        blue: 'border-blue-300 text-blue-700 hover:bg-blue-50',
        slate: 'border-slate-300 text-slate-700 hover:bg-slate-50',
        red: 'border-red-300 text-red-700 hover:bg-red-50',
    };
    return (
        <button
            disabled={disabled}
            onClick={onClick}
            title={title}
            className={`cursor-pointer px-2.5 py-1 rounded text-xs font-medium border shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
        >
            {children}
        </button>
    );
}

// `dockerOff`: Docker is yellow / red, so everything that touches OpenSearch is off (OCR alone still works).
function FolderRow({ folder, busy, dockerOff, onRun, onCleanup, selected, onToggle }) {
    const [open, setOpen] = useState(folder.pending > 0 && folder.files.length <= 6); // pending includes OCRed, so folders awaiting review open up
    const name = folder.dir || '(no scan_config folder)';
    const c = folder.counts;
    const off = busy || !folder.runnable;
    return (
        <div className="border border-slate-200 rounded-md">
            <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                <input type="checkbox" className="cursor-pointer" checked={selected.has(folder.dir)} disabled={!folder.runnable}
                    onChange={() => onToggle(folder.dir)} aria-label={`Select ${name}`}
                    title={folder.runnable ? 'Select to run OCR / index on several folders at once' : 'Not under a scan_config folder, so it cannot be targeted'} />
                <button onClick={() => setOpen((o) => !o)} className="cursor-pointer text-slate-400 hover:text-slate-700 w-4" aria-label="toggle files">
                    {open ? '▾' : '▸'}
                </button>
                <div className="flex-1 min-w-[12rem]">
                    <div className="text-sm text-slate-800 truncate" title={name}>{name}</div>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                        {c.not_indexed > 0 && <Pill status="not_indexed" count={c.not_indexed} />}
                        {c.ocred > 0 && <Pill status="ocred" count={c.ocred} />}
                        {c.indexed > 0 && <Pill status="indexed" count={c.indexed} />}
                    </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <ActionButton
                        disabled={off || c.not_indexed === 0}
                        onClick={() => onRun(folder.dir, 'ocr')}
                        title="Run OCR and generate the text folder (no OpenSearch indexing), so you can check the output in Eval first"
                    >
                        OCR only
                    </ActionButton>
                    <ActionButton
                        disabled={off || dockerOff || folder.pending === 0}
                        onClick={() => onRun(folder.dir, 'index')}
                        title="OCR (if needed), wait for LLM batch jobs, then index"
                    >
                        Index
                    </ActionButton>
                    <ActionButton
                        tone="slate"
                        disabled={off || dockerOff || c.indexed === 0}
                        onClick={() => onRun(folder.dir, 'reindex')}
                        title="Force the index step again for files already indexed (no re-OCR)"
                    >
                        Re-index
                    </ActionButton>
                    <ActionButton
                        tone="red"
                        disabled={off || dockerOff || c.indexed + c.ocred === 0}
                        onClick={() => onCleanup(folder.dir)}
                        title="Remove this folder's documents from OpenSearch and its index state (keeps the ocr/text folders)"
                    >
                        Cleanup…
                    </ActionButton>
                </div>
            </div>
            {open && (
                <div className="px-3 pb-2 pl-10 divide-y divide-slate-100 border-t border-slate-100">
                    {folder.files.map((f) => <FileRow key={f.relative_path} file={f} />)}
                </div>
            )}
        </div>
    );
}

// A category opens by itself when something in it needs ingesting; otherwise it stays folded but one click away,
// so already-indexed files can still be opened in Eval for a spot check.
function CategoryCard({ cat, busy, dockerOff, onRun, onCleanup, selected, onToggle }) {
    const pending = cat.counts.not_indexed + cat.counts.ocred;
    const [open, setOpen] = useState(pending > 0);
    return (
        <Card
            title={
                <button onClick={() => setOpen((o) => !o)} className="cursor-pointer flex items-center gap-2 hover:text-blue-700" aria-expanded={open}>
                    <span className="text-slate-400 w-3">{open ? '▾' : '▸'}</span>{cat.name}
                    <span className="text-xs font-normal text-slate-400">{cat.folders.length} folders</span>
                </button>
            }
            right={
                <div className="flex gap-1.5">
                    {cat.counts.not_indexed > 0 && <Pill status="not_indexed" count={cat.counts.not_indexed} />}
                    {cat.counts.ocred > 0 && <Pill status="ocred" count={cat.counts.ocred} />}
                    <Pill status="indexed" count={cat.counts.indexed} />
                </div>
            }
        >
            {open ? (
                <div className="space-y-2">
                    {cat.folders.map((f) => <FolderRow key={f.dir || '(none)'} folder={f} busy={busy} dockerOff={dockerOff} onRun={onRun} onCleanup={onCleanup} selected={selected} onToggle={onToggle} />)}
                </div>
            ) : (
                <p className="text-sm text-slate-400">
                    {pending === 0 ? 'Everything here is indexed. ' : ''}
                    <button onClick={() => setOpen(true)} className="cursor-pointer text-blue-600 hover:underline">Show folders</button>
                </p>
            )}
        </Card>
    );
}

// Appears once folders are ticked: run OCR / Index / Re-index across all of them in one job (one shared wait for LLM batches).
function SelectionBar({ folders, busy, dockerOff, onRun, onClear }) {
    const n = folders.length;
    const needOcr = folders.filter((f) => f.counts.not_indexed > 0).length;
    const toIndex = folders.filter((f) => f.pending > 0).length;
    const hasIndexed = folders.filter((f) => f.counts.indexed > 0).length;
    const btn = 'cursor-pointer px-3 py-1.5 rounded text-sm font-medium border shadow-sm disabled:opacity-40 disabled:cursor-not-allowed';
    return (
        <div className="sticky top-2 z-10 bg-white border-2 border-blue-300 rounded-lg shadow-md px-4 py-2.5 flex flex-wrap items-center gap-3" data-testid="selection-bar">
            <div className="flex-1 min-w-[12rem]">
                <div className="text-sm font-semibold text-slate-800">{n} folder{n === 1 ? '' : 's'} selected</div>
                <div className="text-xs text-slate-500">OCR needed in {needOcr} · {toIndex} to index · {hasIndexed} already indexed. Folders a step doesn't apply to are skipped.</div>
            </div>
            <button disabled={busy || needOcr === 0} onClick={() => onRun('ocr')} className={`${btn} border-blue-300 text-blue-700 hover:bg-blue-50`}
                title="OCR the selected folders that still need it (no indexing)">OCR only</button>
            <button disabled={busy || dockerOff || toIndex === 0} onClick={() => onRun('index')} className={`${btn} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`}
                title="OCR (if needed), wait for LLM batch jobs once, then index the selected folders">Index</button>
            <button disabled={busy || dockerOff || hasIndexed === 0} onClick={() => onRun('reindex')} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}
                title="Force the index step again for the selected folders that are already indexed">Re-index</button>
            <button onClick={onClear} className="cursor-pointer text-xs text-blue-600 hover:underline">Clear</button>
        </div>
    );
}

export default function DiscoverPage() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [cleanup, setCleanup] = useState(null);
    const [selected, setSelected] = useState(() => new Set());
    const jobsRef = useRef(null);

    const load = useCallback(async () => {
        setLoading(true);
        try { setData(await api('/discover/status')); } catch (e) { jobsRef.current?.setError(e.message); }
        setLoading(false);
    }, []);

    // When a run ends, rescan so files that just got indexed drop out of the pending list.
    const jobs = useJobs('discover', load);
    const dockerOff = !!useDevShell().docker?.blocked;
    jobsRef.current = jobs;

    useEffect(() => { load(); }, [load]);

    const start = async (folders, mode) => {
        jobs.setError('');
        try {
            const { run_id: runId } = await postJson('/discover/runs', { folders, mode });
            await jobs.started(runId);
            return true;
        } catch (e) { jobs.setError(e.message); return false; }
    };

    const allFolders = useMemo(() => (data ? data.categories.flatMap((c) => c.folders) : []), [data]);
    const selectedFolders = useMemo(() => allFolders.filter((f) => selected.has(f.dir)), [allFolders, selected]);
    const toggleSelected = (dir) => setSelected((cur) => {
        const next = new Set(cur);
        if (next.has(dir)) next.delete(dir); else next.add(dir);
        return next;
    });
    const selectPending = () => setSelected(new Set(allFolders.filter((f) => f.runnable && f.pending > 0).map((f) => f.dir)));
    const runSelected = async (mode) => { if (await start(selectedFolders.map((f) => f.dir), mode)) setSelected(new Set()); };

    // A rescan can remove a folder (e.g. after cleanup); never keep selecting something that is no longer listed.
    useEffect(() => {
        if (!data) return;
        const known = new Set(allFolders.map((f) => f.dir));
        setSelected((cur) => (cur.size && [...cur].some((d) => !known.has(d)) ? new Set([...cur].filter((d) => known.has(d))) : cur));
    }, [data, allFolders]);

    const runCleanup = async (folder) => {
        jobs.setError('');
        try {
            const { run_id: runId } = await postJson('/discover/cleanup', { folder, confirm: true });
            await jobs.started(runId);
        } catch (e) { jobs.setError(e.message); }
    };

    const totals = data?.totals;
    const pendingFolders = data ? data.categories.reduce((n, c) => n + c.folders.filter((f) => f.pending > 0 && f.runnable).length, 0) : 0;

    return (
        <PageShell title="Discover" subtitle="Crawl and index PDFs that aren't in OpenSearch yet">
            <div className="bg-white border-2 border-blue-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                    <h2 className="text-base font-semibold text-slate-800">
                        {!totals ? 'Scanning…' : totals.pending === 0 ? 'Everything is indexed' : `${totals.pending} file${totals.pending === 1 ? '' : 's'} to ingest`}
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                        Runs crawl + index on each folder, one after another. If OCR goes to an LLM batch job, it waits for the job and carries on by itself.
                    </p>
                    {totals && (
                        <div className="flex flex-wrap gap-2 mt-3">
                            <Pill status="not_indexed" count={totals.not_indexed} />
                            <Pill status="ocred" count={totals.ocred} />
                            <Pill status="indexed" count={totals.indexed} />
                        </div>
                    )}
                </div>
                <div className="flex flex-col items-stretch gap-2">
                    <button
                        disabled={jobs.busy || dockerOff || !totals || totals.pending === 0}
                        onClick={() => start(null, 'index')}
                        className="cursor-pointer px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold shadow-md hover:shadow-lg transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none whitespace-nowrap"
                    >
                        {jobs.busy ? 'A job is in progress…' : dockerOff ? 'Docker is not ready' : `Discover all pending${pendingFolders ? ` (${pendingFolders} folder${pendingFolders === 1 ? '' : 's'})` : ''}  ▶`}
                    </button>
                    <button
                        disabled={jobs.busy || !totals || totals.not_indexed === 0}
                        onClick={() => start(null, 'ocr')}
                        className="cursor-pointer text-xs text-blue-700 hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                        title="OCR everything not yet OCRed, but don't index. Check it in Eval first."
                    >
                        OCR only, evaluate before indexing
                    </button>
                </div>
            </div>

            <ErrorBanner message={jobs.error} onClose={() => jobs.setError('')} />
            <BusyNotice jobs={jobs} />
            <DockerBlockedNotice />
            <RunPanel jobs={jobs} />

            {selectedFolders.length > 0 && (
                <SelectionBar folders={selectedFolders} busy={jobs.busy} dockerOff={dockerOff} onRun={runSelected} onClear={() => setSelected(new Set())} />
            )}

            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">Files</h2>
                <div className="flex items-center gap-4 text-xs">
                    <button onClick={selectPending} disabled={!allFolders.some((f) => f.runnable && f.pending > 0)}
                        className="cursor-pointer text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">Select pending</button>
                    {data && <span className="text-slate-400">scanned {timeAgo(data.generated_at)}</span>}
                    <button onClick={load} disabled={loading} className="cursor-pointer text-blue-600 hover:underline disabled:opacity-50">
                        {loading ? 'scanning…' : 'rescan'}
                    </button>
                </div>
            </div>

            {!data && <p className="text-sm text-slate-400">Loading…</p>}
            {data && data.categories.map((cat) => (
                <CategoryCard key={cat.name} cat={cat} busy={jobs.busy} dockerOff={dockerOff}
                    onRun={(d, mode) => start([d], mode)} onCleanup={(d) => setCleanup(d)} selected={selected} onToggle={toggleSelected} />
            ))}

            <JobHistory jobs={jobs} />

            {cleanup && (
                <ConfirmModal
                    title="Clean up this folder?"
                    lines={[
                        cleanup,
                        'Deletes its documents from OpenSearch and its index state (SQLite).',
                        'Also removes its catalogue row and metadata values if no other PDF in the work is indexed.',
                        'Keeps the ocr/ and text/ folders, so indexing again needs no re-OCR.',
                    ]}
                    phrase="cleanup"
                    confirmLabel="Clean up"
                    onCancel={() => setCleanup(null)}
                    onConfirm={() => { const d = cleanup; setCleanup(null); runCleanup(d); }}
                />
            )}
        </PageShell>
    );
}
