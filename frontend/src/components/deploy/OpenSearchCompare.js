import React, { useState, useCallback, useEffect, useRef } from 'react';
import { api, timeAgo } from '../dev/JobUI';

export const COMPARE_EVERY_MS = 5 * 60 * 1000;

const SHORT = { cataloguesearch_prod: 'Content', cataloguesearch_prod_metadata: 'Metadata', cataloguesearch_prod_catalogue: 'Catalogue' };
const fmt = (n) => (n == null ? '–' : n.toLocaleString());
const mb = (b) => (b == null ? '' : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(1)} MB`);

const KINDS = [
    ['missing_on_prod', 'Not on prod yet'],
    ['changed', 'Changed on dev'],
    ['only_on_prod', 'Only on prod'],
];

function Rows({ index }) {
    if (!index.diff) {
        return <p className="text-xs text-red-600">This index exists on only one side.</p>;
    }
    const isMain = index.name === 'cataloguesearch_prod';
    return (
        <div className="space-y-2">
            {KINDS.map(([kind, label]) => {
                const group = index.diff[kind];
                if (!group.total) return null;
                return (
                    <div key={kind}>
                        <div className="text-xs font-medium text-slate-600">{label} ({group.total})</div>
                        <ul className="text-xs text-slate-500 mt-0.5 max-h-40 overflow-auto">
                            {group.items.map((it) => {
                                const key = isMain ? it.document_id : it;
                                return (
                                    <li key={key} className="truncate">
                                        {isMain ? `${it.name} · ${it.chunks} chunks${it.prod_chunks != null ? ` (prod ${it.prod_chunks})` : ''}` : it}
                                    </li>
                                );
                            })}
                            {group.total > group.items.length && <li>…and {group.total - group.items.length} more</li>}
                        </ul>
                    </div>
                );
            })}
        </div>
    );
}

// Compares dev and prod in the background: when the page opens, then every 5 minutes (skipped while the tab is hidden).
// Failures leave `report` empty, which the page treats as "unknown" rather than "in sync".
export function useOpenSearchCompare() {
    const [state, setState] = useState({ loading: false, report: null, error: '', checkedAt: null });
    const inflight = useRef(false);

    const refresh = useCallback(async () => {
        if (inflight.current) return;
        inflight.current = true;
        setState((s) => ({ ...s, loading: true }));
        const done = (fields) => setState({ loading: false, report: null, error: '', checkedAt: new Date().toISOString(), ...fields });
        try {
            const report = await api('/deploy/compare');
            done(report.error ? { error: report.error } : { report });
        } catch (e) {
            done({ error: e.message });
        } finally {
            inflight.current = false;
        }
    }, []);

    useEffect(() => {
        refresh();
        const timer = setInterval(() => { if (!document.hidden) refresh(); }, COMPARE_EVERY_MS);
        return () => clearInterval(timer);
    }, [refresh]);

    return { ...state, refresh };
}

export default function OpenSearchCompare({ compare }) {
    const { loading, report, error, checkedAt, refresh } = compare;
    return (
        <div className="mb-3 border border-slate-200 rounded p-3 space-y-2" data-testid="compare-box">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">Dev vs Prod</span>
                <span className="text-xs text-slate-400">
                    {checkedAt && !loading ? `checked ${timeAgo(checkedAt)} · ` : ''}
                    <button onClick={refresh} disabled={loading} className="cursor-pointer text-blue-600 hover:underline disabled:opacity-50">
                        {loading ? 'comparing…' : 'check now'}
                    </button>
                </span>
            </div>
            {!report && !error && <p className="text-sm text-slate-400">Comparing with prod…</p>}
            {error && <p className="text-sm text-red-600 break-words">Could not compare: {error}</p>}
            {report && (
                <>
                    <p data-testid="compare-verdict" className={`text-sm font-medium ${report.in_sync ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {report.in_sync ? 'In sync. Nothing to push to prod.'
                            : `Differences in ${report.differing.length} of ${report.indices.length} indices. A sync would change prod.`}
                    </p>
                    <div className="space-y-2">
                        {report.indices.map((i) => (
                            <div key={i.name} className="text-xs border border-slate-100 rounded p-2 space-y-1">
                                <div className="flex justify-between">
                                    <span className="font-medium text-slate-700">{SHORT[i.name] || i.name}</span>
                                    <span className={i.in_sync ? 'text-emerald-600' : 'text-amber-600'}>{i.in_sync ? 'same' : 'differs'}</span>
                                </div>
                                <div className="text-slate-500">
                                    dev {fmt(i.dev.docs)} docs {mb(i.dev.bytes)} · prod {fmt(i.prod.docs)} docs {mb(i.prod.bytes)}
                                </div>
                                {!i.in_sync && <Rows index={i} />}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
