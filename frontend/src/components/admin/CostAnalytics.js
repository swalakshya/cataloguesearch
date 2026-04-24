import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';

const ALL_STEPS = ['keyword_extract', 'filter_map', 'keyword_fix', 'answer_synthesis', 'answer_json_repair'];

const STEP_LABELS = {
    keyword_extract: 'Keyword Extract',
    filter_map: 'Filter Map',
    keyword_fix: 'Keyword Fix',
    answer_synthesis: 'Answer Synthesis',
    answer_json_repair: 'Answer JSON Repair',
};

function formatDateInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function createDefaultFilters() {
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - 6);
    return {
        preset: '7d',
        startDate: formatDateInput(from),
        endDate: formatDateInput(today),
        userId: '',
        sessionId: '',
        requestId: '',
        steps: [],
        limit: 50,
        offset: 0,
    };
}

function buildRange(filters) {
    const now = new Date();
    if (filters.preset === '24h') {
        return { fromTs: now.getTime() - 86400000, toTs: now.getTime() };
    }
    if (filters.preset === '7d' || filters.preset === '30d') {
        const days = filters.preset === '7d' ? 6 : 29;
        const from = new Date(now);
        from.setDate(now.getDate() - days);
        return { fromTs: startOfDay(from).getTime(), toTs: endOfDay(now).getTime() };
    }
    const from = filters.startDate ? startOfDay(new Date(filters.startDate)) : null;
    const to = filters.endDate ? endOfDay(new Date(filters.endDate)) : null;
    return { fromTs: from ? from.getTime() : null, toTs: to ? to.getTime() : null };
}

function formatTs(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleString(); } catch { return String(value); }
}

function fmtTokens(n) {
    if (n == null) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}

function SummaryCard({ label, value, sub }) {
    return (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">{label}</div>
            <div className="text-2xl font-bold text-slate-800">{value}</div>
            {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
        </div>
    );
}

function StepBadge({ step }) {
    const colors = {
        keyword_extract: 'bg-blue-100 text-blue-700',
        filter_map: 'bg-purple-100 text-purple-700',
        keyword_fix: 'bg-yellow-100 text-yellow-700',
        answer_synthesis: 'bg-green-100 text-green-700',
        answer_json_repair: 'bg-red-100 text-red-700',
    };
    return (
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[step] || 'bg-slate-100 text-slate-600'}`}>
            {STEP_LABELS[step] || step}
        </span>
    );
}

export default function CostAnalytics({ token, onSessionExpired }) {
    const [filters, setFilters] = useState(createDefaultFilters);
    const [draft, setDraft] = useState(createDefaultFilters);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState(new Set());

    const load = useCallback(async (f) => {
        setLoading(true);
        setError(null);
        try {
            const { fromTs, toTs } = buildRange(f);
            const result = await api.getCostAnalysis(token, {
                fromTs,
                toTs,
                userId: f.userId || undefined,
                sessionId: f.sessionId || undefined,
                requestId: f.requestId || undefined,
                steps: f.steps.length ? f.steps : undefined,
                limit: f.limit,
                offset: f.offset,
            });
            setData(result);
            setExpanded(new Set());
        } catch (err) {
            if (err?.message === 'Unauthorized') { onSessionExpired?.(); return; }
            setError(err?.message || 'Failed to load cost analysis');
        } finally {
            setLoading(false);
        }
    }, [token, onSessionExpired]);

    useEffect(() => { load(filters); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const applyFilters = () => {
        const next = { ...draft, offset: 0 };
        setFilters(next);
        load(next);
    };

    const resetFilters = () => {
        const def = createDefaultFilters();
        setDraft(def);
        setFilters(def);
        load(def);
    };

    const setPage = (offset) => {
        const next = { ...filters, offset };
        setFilters(next);
        load(next);
    };

    const toggleStep = (step) => {
        setDraft((d) => ({
            ...d,
            steps: d.steps.includes(step) ? d.steps.filter((s) => s !== step) : [...d.steps, step],
        }));
    };

    const toggleRow = (id) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const summary = data?.summary;
    const requests = data?.requests || [];
    const total = data?.total || 0;
    const totalPages = Math.ceil(total / filters.limit);
    const currentPage = Math.floor(filters.offset / filters.limit) + 1;

    const inputCls = 'border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500';
    const presetCls = (p) => `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${draft.preset === p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`;

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h2 className="text-2xl font-bold text-slate-800">Cost Analytics</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                    Actual LLM token usage per request, broken down by step.
                </p>
            </div>

            {/* Filters */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
                <div className="flex flex-wrap gap-3 items-end">
                    {/* Date preset */}
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-500">Date range</span>
                        <div className="flex gap-1">
                            {['24h', '7d', '30d', 'custom'].map((p) => (
                                <button key={p} className={presetCls(p)} onClick={() => setDraft((d) => ({ ...d, preset: p }))}>
                                    {p === '24h' ? '24 h' : p === '7d' ? '7 days' : p === '30d' ? '30 days' : 'Custom'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {draft.preset === 'custom' && (
                        <div className="flex gap-2 items-center">
                            <input type="date" value={draft.startDate} onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} className={inputCls} style={{ width: 140 }} />
                            <span className="text-slate-400 text-sm">to</span>
                            <input type="date" value={draft.endDate} onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} className={inputCls} style={{ width: 140 }} />
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">User ID</label>
                        <input className={inputCls} placeholder="Filter by user" value={draft.userId} onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value }))} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">Session ID</label>
                        <input className={inputCls} placeholder="Filter by session" value={draft.sessionId} onChange={(e) => setDraft((d) => ({ ...d, sessionId: e.target.value }))} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">Request ID</label>
                        <input className={inputCls} placeholder="Filter by request" value={draft.requestId} onChange={(e) => setDraft((d) => ({ ...d, requestId: e.target.value }))} />
                    </div>
                </div>

                {/* Step type multi-select */}
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-500">Step type <span className="text-slate-400 font-normal">(leave empty for all)</span></span>
                    <div className="flex flex-wrap gap-2">
                        {ALL_STEPS.map((step) => {
                            const active = draft.steps.includes(step);
                            return (
                                <button
                                    key={step}
                                    onClick={() => toggleStep(step)}
                                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'}`}
                                >
                                    {STEP_LABELS[step]}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={applyFilters} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
                        Apply
                    </button>
                    <button onClick={resetFilters} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors">
                        Reset
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">{error}</div>
            )}

            {/* Summary cards */}
            {summary && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <SummaryCard label="Requests" value={fmtTokens(summary.request_count)} />
                    <SummaryCard label="Input tokens" value={fmtTokens(summary.input_tokens)} />
                    <SummaryCard label="Cached tokens" value={fmtTokens(summary.cached_input_tokens)} sub="of input" />
                    <SummaryCard label="Output tokens" value={fmtTokens(summary.output_tokens)} />
                    <SummaryCard label="Total tokens" value={fmtTokens(summary.total_tokens)} />
                </div>
            )}

            {/* Requests table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                    <span className="text-sm font-medium text-slate-700">
                        {loading ? 'Loading…' : `${total} request${total !== 1 ? 's' : ''}`}
                    </span>
                    {total > filters.limit && (
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <button disabled={currentPage === 1} onClick={() => setPage(filters.offset - filters.limit)} className="px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-40">←</button>
                            <span>Page {currentPage} of {totalPages}</span>
                            <button disabled={currentPage === totalPages} onClick={() => setPage(filters.offset + filters.limit)} className="px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-40">→</button>
                        </div>
                    )}
                </div>

                {requests.length === 0 && !loading ? (
                    <div className="px-5 py-12 text-center text-slate-400 text-sm">
                        No data for the selected filters.
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-xs text-slate-500 font-medium border-b border-slate-100">
                                <th className="text-left px-4 py-2 w-6"></th>
                                <th className="text-left px-4 py-2">Created</th>
                                <th className="text-left px-4 py-2">Request ID</th>
                                <th className="text-left px-4 py-2">User / Session</th>
                                <th className="text-right px-4 py-2">Input</th>
                                <th className="text-right px-4 py-2">Output</th>
                                <th className="text-right px-4 py-2">Total</th>
                                <th className="text-left px-4 py-2">Steps</th>
                            </tr>
                        </thead>
                        <tbody>
                            {requests.map((req) => {
                                const isOpen = expanded.has(req.request_id);
                                const u = req.llm_usage_summary || {};
                                return (
                                    <React.Fragment key={req.request_id}>
                                        <tr
                                            className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                                            onClick={() => toggleRow(req.request_id)}
                                        >
                                            <td className="px-4 py-2.5 text-slate-400">{isOpen ? '▾' : '▸'}</td>
                                            <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{formatTs(req.created_at)}</td>
                                            <td className="px-4 py-2.5 font-mono text-xs text-slate-500 max-w-[140px] truncate">{req.request_id}</td>
                                            <td className="px-4 py-2.5 text-xs text-slate-500">
                                                {req.user_id && <div className="truncate max-w-[120px]">{req.user_id}</div>}
                                                {req.session_id && <div className="font-mono truncate max-w-[120px] text-slate-400">{req.session_id}</div>}
                                            </td>
                                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtTokens(u.input_tokens)}</td>
                                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtTokens(u.output_tokens)}</td>
                                            <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-800">{fmtTokens(u.total_tokens)}</td>
                                            <td className="px-4 py-2.5">
                                                <div className="flex flex-wrap gap-1">
                                                    {(req.llm_calls || []).map((c, i) => <StepBadge key={i} step={c.step} />)}
                                                </div>
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr className="bg-slate-50 border-b border-slate-100">
                                                <td colSpan={8} className="px-6 py-3">
                                                    <table className="w-full text-xs">
                                                        <thead>
                                                            <tr className="text-slate-500 font-medium">
                                                                <th className="text-left py-1 pr-4">Step</th>
                                                                <th className="text-right py-1 pr-4">Input</th>
                                                                <th className="text-right py-1 pr-4">Output</th>
                                                                <th className="text-right py-1 pr-4">Cached</th>
                                                                <th className="text-right py-1 pr-4">Thought</th>
                                                                <th className="text-left py-1 pr-4">Model version</th>
                                                                <th className="text-left py-1">Response ID</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {(req.llm_calls || []).map((call, i) => {
                                                                const cu = call.usage_normalized || {};
                                                                return (
                                                                    <tr key={i} className="border-t border-slate-200">
                                                                        <td className="py-1.5 pr-4"><StepBadge step={call.step} /></td>
                                                                        <td className="py-1.5 pr-4 text-right tabular-nums">{fmtTokens(cu.input_tokens)}</td>
                                                                        <td className="py-1.5 pr-4 text-right tabular-nums">{fmtTokens(cu.output_tokens)}</td>
                                                                        <td className="py-1.5 pr-4 text-right tabular-nums text-slate-400">{fmtTokens(cu.cached_input_tokens)}</td>
                                                                        <td className="py-1.5 pr-4 text-right tabular-nums text-slate-400">{cu.thought_tokens != null ? fmtTokens(cu.thought_tokens) : '—'}</td>
                                                                        <td className="py-1.5 pr-4 font-mono text-slate-500">{call.model_version || '—'}</td>
                                                                        <td className="py-1.5 font-mono text-slate-400 truncate max-w-[160px]">{call.provider_response_id || '—'}</td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
