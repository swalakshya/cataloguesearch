import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    api, postJson, timeAgo, Card, ErrorBanner, ConfirmModal, useJobs, BusyNotice, RunPanel, JobHistory,
} from '../dev/JobUI';
import { useDevShell, DockerBlockedNotice } from '../dev/DevShell';

// Decimal units, like `docker system df`, so the numbers here match what you'd see on the machine.
export function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1000) return `${Math.round(v)} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let x = v;
    let i = -1;
    do { x /= 1000; i += 1; } while (x >= 1000 && i < units.length - 1);
    return `${x.toFixed(1)} ${units[i]}`;
}

const TARGETS = [['local', 'This machine'], ['prod', 'Prod']];
const CACHE_DEFAULT = 'all';

function Items({ items }) {
    if (!items || items.length === 0) return <p className="text-xs text-slate-400 py-1">Nothing listed.</p>;
    return (
        <ul className="text-xs divide-y divide-slate-100">
            {items.map((it) => (
                <li key={it.name} className="flex justify-between gap-3 py-1">
                    <span className="truncate font-mono text-slate-600" title={it.name}>{it.name}{it.note ? <span className="text-slate-400 font-sans"> · {it.note}</span> : null}</span>
                    <span className="shrink-0 text-slate-500">{it.size ? formatBytes(it.size) : ''}</span>
                </li>
            ))}
        </ul>
    );
}

function CategoryRow({ cat, checked, onCheck, busy, onClean, variant, onVariant }) {
    const [open, setOpen] = useState(false);
    const cleanable = cat.reclaimable > 0 || (cat.id === 'unused_networks' && cat.count > 0);
    const variants = cat.variants || null;
    const chosen = variants ? (variants.find((v) => v.id === variant) || variants[variants.length - 1]) : null;
    const amount = chosen ? chosen.reclaimable : cat.reclaimable;
    return (
        <div className="border border-slate-200 rounded-md bg-white" data-testid={`row-${cat.id}`}>
            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <input type="checkbox" className="cursor-pointer" checked={checked} disabled={!cleanable} onChange={() => onCheck(cat.id)}
                    aria-label={`Select ${cat.title}`} />
                <button onClick={() => setOpen((o) => !o)} className="cursor-pointer text-slate-400 hover:text-slate-700 w-4" aria-label={`Show ${cat.title} details`}>
                    {open ? '▾' : '▸'}
                </button>
                <div className="flex-1 min-w-[14rem]">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{cat.title}</span>
                        {!cat.safe && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title="Not part of “Clean all safe”; asks for confirmation">OPTIONAL</span>}
                    </div>
                    <div className="text-xs text-slate-500">{cat.description}</div>
                </div>
                <div className="text-right w-24 text-xs text-slate-500">
                    {cat.count} {cat.count === 1 ? 'item' : 'items'}
                    {cat.protected?.count > 0 && <div className="text-emerald-700" data-testid={`kept-${cat.id}`}>{cat.protected.count} kept</div>}
                </div>
                <div className="text-right w-28">
                    <div className="text-sm font-semibold text-slate-800" data-testid={`size-${cat.id}`}>{cat.id === 'unused_networks' ? '—' : formatBytes(amount)}</div>
                    {cat.id !== 'unused_networks' && <div className="text-[11px] text-slate-400">can be freed</div>}
                </div>
                <div className="flex items-center gap-1.5">
                    {variants && (
                        <select value={chosen.id} onChange={(e) => onVariant(cat.id, e.target.value)} aria-label="Build cache scope"
                            className="text-xs border border-slate-300 rounded px-1.5 py-1 cursor-pointer">
                            {variants.map((v) => <option key={v.id} value={v.id}>{v.label} ({formatBytes(v.reclaimable)})</option>)}
                        </select>
                    )}
                    <button disabled={busy || !cleanable} onClick={() => onClean(cat)}
                        className="cursor-pointer px-3 py-1.5 rounded text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                        Clean{cat.safe ? '' : '…'}
                    </button>
                </div>
            </div>
            {open && (
                <div className="px-4 pb-2 pl-12 border-t border-slate-100">
                    <Items items={cat.items} />
                    {cat.protected?.count > 0 && (
                        <div className="mt-2" data-testid={`protected-${cat.id}`}>
                            <div className="text-xs font-medium text-emerald-700">Kept: named in your compose files, never removed here ({formatBytes(cat.protected.size)})</div>
                            <Items items={cat.protected.items} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function CleanupTab({ prodHost }) {
    const [target, setTarget] = useState('local');
    const [scan, setScan] = useState(null);
    const [scanError, setScanError] = useState('');
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [variants, setVariants] = useState({ build_cache: CACHE_DEFAULT });
    const [confirm, setConfirm] = useState(null);
    const targetRef = useRef(target);
    targetRef.current = target;

    const load = useCallback(async (t) => {
        setLoading(true);
        setScanError('');
        try {
            const data = await api(`/deploy/gc/scan?target=${t}`);
            if (targetRef.current === t) setScan(data);          // ignore a slow answer for a machine you've since left
        } catch (e) {
            if (targetRef.current === t) { setScan(null); setScanError(e.message); }
        }
        if (targetRef.current === t) setLoading(false);
    }, []);

    // Rescan when the run ends, so the numbers show what is left.
    const jobs = useJobs('gc', () => load(targetRef.current));

    useEffect(() => { setSelected(new Set()); setScan(null); load(target); }, [target, load]);

    const cats = useMemo(() => (scan ? scan.categories : []), [scan]);
    const byId = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c])), [cats]);
    const amountOf = useCallback((c) => {
        const v = c.variants ? c.variants.find((x) => x.id === (variants[c.id] || CACHE_DEFAULT)) : null;
        return v ? v.reclaimable : c.reclaimable;
    }, [variants]);
    const selectedCats = cats.filter((c) => selected.has(c.id));
    const selectedTotal = selectedCats.reduce((n, c) => n + amountOf(c), 0);
    const safeCats = cats.filter((c) => c.safe && (c.reclaimable > 0 || (c.id === 'unused_networks' && c.count > 0)));
    const safeTotal = safeCats.reduce((n, c) => n + amountOf(c), 0);

    const toggle = (id) => setSelected((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const run = useCallback(async (list, confirmed) => {
        jobs.setError('');
        try {
            const { run_id: runId } = await postJson('/deploy/gc/run', {
                target,
                categories: list.map((c) => ({ id: c.id, ...(c.id === 'build_cache' ? { variant: variants.build_cache || CACHE_DEFAULT } : {}) })),
                confirm: confirmed,
            });
            setSelected(new Set());
            await jobs.started(runId);
        } catch (e) { jobs.setError(e.message); }
    }, [target, variants, jobs]);

    // Prod, or anything beyond the safe items, asks for a typed confirmation first.
    const request = (list) => {
        if (list.length === 0) return;
        const optional = list.filter((c) => !c.safe);
        if (target !== 'prod' && optional.length === 0) { run(list, false); return; }
        const total = list.reduce((n, c) => n + amountOf(c), 0);
        setConfirm({
            list,
            phrase: target === 'prod' ? 'prod' : 'clean',
            title: target === 'prod' ? `Clean up prod (${prodHost || 'prod'})?` : 'Remove optional items?',
            lines: [
                ...list.map((c) => `${c.title}: about ${c.id === 'unused_networks' ? 'nothing (tiny)' : formatBytes(amountOf(c))}`),
                `Frees about ${formatBytes(total)} in total.`,
                ...optional.map((c) => c.description),
                ...list.filter((c) => c.protected?.count > 0).map((c) => `Kept, not touched: ${c.protected.items.map((i) => i.name).join(', ')}`),
            ],
        });
    };

    const busy = jobs.busy;
    // Cleaning this machine talks to Docker; cleaning prod goes over ssh and does not.
    const dockerBlocked = !!useDevShell().docker?.blocked;
    const dockerOff = target === 'local' && dockerBlocked;
    const off = busy || dockerOff;
    const unusedVolumes = scan?.volumes;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-md border border-slate-300 overflow-hidden" role="tablist" aria-label="Machine">
                    {TARGETS.map(([id, label]) => (
                        <button key={id} role="tab" aria-selected={target === id} onClick={() => setTarget(id)}
                            className={`cursor-pointer px-4 py-1.5 text-sm ${target === id ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                            {id === 'prod' && prodHost ? `${label} (${prodHost})` : label}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-3 text-xs">
                    {scan && <span className="text-slate-400">scanned {timeAgo(scan.generated_at)}</span>}
                    <button onClick={() => load(target)} disabled={loading} className="cursor-pointer text-blue-600 hover:underline disabled:opacity-50">
                        {loading ? 'scanning…' : 'rescan'}
                    </button>
                </div>
            </div>

            <ErrorBanner message={jobs.error} onClose={() => jobs.setError('')} />
            <BusyNotice jobs={jobs} />
            {target === 'local' && <DockerBlockedNotice />}
            {scanError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3" role="alert">{scanError}</div>
            )}

            {scan && (
                <div className="bg-white border-2 border-blue-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex-1">
                        <h2 className="text-base font-semibold text-slate-800" data-testid="headline">
                            {safeTotal > 0 ? `${formatBytes(safeTotal)} can be freed safely` : 'Nothing safe to clean'}
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">
                            {scan.label}. “Clean all safe” removes dangling images, build cache, stopped containers and unused networks.
                            {scan.totals.optional > 0 && <> A further <span className="font-medium">{formatBytes(scan.totals.optional)}</span> is optional and asks for confirmation.</>}
                        </p>
                    </div>
                    <button disabled={off || safeCats.length === 0} onClick={() => request(safeCats)}
                        className="cursor-pointer px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold shadow-md hover:shadow-lg transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none whitespace-nowrap">
                        {busy ? 'A job is in progress…' : dockerOff ? 'Docker is not ready' : `Clean all safe (${formatBytes(safeTotal)})  ▶`}
                    </button>
                </div>
            )}

            {selectedCats.length > 0 && (
                <div className="sticky top-2 z-10 bg-white border-2 border-blue-300 rounded-lg shadow-md px-4 py-2.5 flex flex-wrap items-center gap-3" data-testid="selection-bar">
                    <div className="flex-1 text-sm font-semibold text-slate-800">{selectedCats.length} selected · about {formatBytes(selectedTotal)}</div>
                    <button disabled={off} onClick={() => request(selectedCats)}
                        className="cursor-pointer px-3 py-1.5 rounded text-sm font-medium border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                        Clean selected
                    </button>
                    <button onClick={() => setSelected(new Set())} className="cursor-pointer text-xs text-blue-600 hover:underline">Clear</button>
                </div>
            )}

            {!scan && !scanError && <p className="text-sm text-slate-400">Scanning…</p>}
            <div className="space-y-2">
                {cats.map((c) => (
                    <CategoryRow key={c.id} cat={c} checked={selected.has(c.id)} onCheck={toggle} busy={off}
                        variant={variants[c.id]} onVariant={(id, v) => setVariants((cur) => ({ ...cur, [id]: v }))}
                        onClean={(cat) => request([byId[cat.id]])} />
                ))}
            </div>

            {unusedVolumes && (
                <Card title="Volumes (not cleaned here)">
                    <p className="text-xs text-slate-500 mb-2">
                        {unusedVolumes.count} volumes, {unusedVolumes.unused} unused ({formatBytes(unusedVolumes.unused_size)}). Volumes can hold real data
                        (OpenSearch lives in one), so they are listed for information only.
                    </p>
                    <Items items={unusedVolumes.items} />
                </Card>
            )}

            <RunPanel jobs={jobs} />
            <JobHistory jobs={jobs} />

            {confirm && (
                <ConfirmModal
                    title={confirm.title}
                    lines={confirm.lines}
                    phrase={confirm.phrase}
                    confirmLabel="Clean up"
                    onCancel={() => setConfirm(null)}
                    onConfirm={() => { const { list } = confirm; setConfirm(null); run(list, true); }}
                />
            )}
        </div>
    );
}
