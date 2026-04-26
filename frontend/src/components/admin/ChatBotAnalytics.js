import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const COLUMN_STORAGE_KEY = 'admin.chatBotAnalytics.visibleColumns';
const REQUIRED_COLUMNS = ['question', 'status', 'latency'];
const DEFAULT_COLUMNS = ['created', 'request', 'session', 'question', 'status', 'latency'];
const COLUMN_OPTIONS = [
    { id: 'created', label: 'Created' },
    { id: 'request', label: 'Request ID' },
    { id: 'session', label: 'Session ID' },
    { id: 'user', label: 'User ID' },
    { id: 'question', label: 'Question', locked: true },
    { id: 'status', label: 'Status', locked: true },
    { id: 'latency', label: 'Latency', locked: true },
];

function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
        requestId: '',
        sessionId: '',
        userId: '',
        status: 'all',
        limit: 20,
        offset: 0,
    };
}

function buildRange(filters) {
    const now = new Date();
    if (filters.preset === '24h') {
        return {
            fromTs: now.getTime() - 24 * 60 * 60 * 1000,
            toTs: now.getTime(),
        };
    }

    if (filters.preset === '7d' || filters.preset === '30d') {
        const days = filters.preset === '7d' ? 6 : 29;
        const from = new Date(now);
        from.setDate(now.getDate() - days);
        return {
            fromTs: startOfDay(from).getTime(),
            toTs: endOfDay(now).getTime(),
        };
    }

    const from = filters.startDate ? startOfDay(new Date(filters.startDate)) : null;
    const to = filters.endDate ? endOfDay(new Date(filters.endDate)) : null;
    return {
        fromTs: from ? from.getTime() : null,
        toTs: to ? to.getTime() : null,
    };
}

function formatTimestamp(value) {
    if (!value) return '—';
    try {
        return new Date(value).toLocaleString();
    } catch {
        return '—';
    }
}

function formatLatency(value) {
    if (value == null) return '—';
    if (value < 1000) return `${value} ms`;
    return `${(value / 1000).toFixed(1)} s`;
}

function formatCompactId(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '—';
    if (normalized.length <= 8) return normalized;
    return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

function loadVisibleColumns() {
    if (typeof window === 'undefined') return DEFAULT_COLUMNS;
    try {
        const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY);
        if (!raw) return DEFAULT_COLUMNS;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return DEFAULT_COLUMNS;
        const allowed = new Set(COLUMN_OPTIONS.map((option) => option.id));
        const normalized = parsed.filter((columnId) => allowed.has(columnId));
        REQUIRED_COLUMNS.forEach((columnId) => {
            if (!normalized.includes(columnId)) normalized.push(columnId);
        });
        return normalized.length ? normalized : DEFAULT_COLUMNS;
    } catch {
        return DEFAULT_COLUMNS;
    }
}

function persistVisibleColumns(columns) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columns));
    } catch {
        // Best-effort only.
    }
}

function StatusBadge({ status }) {
    const classes = status === 'failed'
        ? 'bg-rose-100 text-rose-700'
        : 'bg-emerald-100 text-emerald-700';
    return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>
            {status}
        </span>
    );
}

function DetailPill({ label, value }) {
    return (
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs">
            <div className="font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 break-words text-slate-800">{value || '—'}</div>
        </div>
    );
}

function ExpandedRequestDetail({ detail, loading, error }) {
    if (loading) {
        return <div className="px-6 py-4 text-sm text-slate-500">Loading request details…</div>;
    }
    if (error) {
        return <div className="px-6 py-4 text-sm text-red-600">{error}</div>;
    }
    if (!detail) return null;

    const details = detail.details || {};

    return (
        <div className="space-y-4 bg-slate-50 px-6 py-4">
            <div>
                <h4 className="text-sm font-semibold text-slate-800">Answer</h4>
                <div className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
                    {details.answer || 'No answer captured for this request.'}
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <DetailPill label="Request ID" value={detail.request_id} />
                <DetailPill label="Session ID" value={detail.session_id} />
                <DetailPill label="User ID" value={detail.user_id} />
                <DetailPill label="Created" value={formatTimestamp(detail.created_at)} />
                <DetailPill label="Workflow" value={detail.workflow} />
                <DetailPill label="Language" value={detail.language} />
                <DetailPill label="Latency" value={formatLatency(detail.latency_ms)} />
                <DetailPill label="Error" value={detail.error} />
                <DetailPill label="Content Type" value={Array.isArray(details.content_type) ? details.content_type.join(', ') : null} />
                <DetailPill label="Provider" value={details.provider} />
                <DetailPill label="Keyword Model" value={details.keyword_model} />
                <DetailPill label="Answer Model" value={details.answer_model} />
                <DetailPill label="Chunks Retrieved" value={details.chunks_retrieved != null ? String(details.chunks_retrieved) : null} />
                <DetailPill label="Tool Calls Used" value={details.tool_calls_used != null ? String(details.tool_calls_used) : null} />
            </div>
        </div>
    );
}

const ChatBotAnalytics = ({ token, onSessionExpired }) => {
    const [draftFilters, setDraftFilters] = useState(() => createDefaultFilters());
    const [appliedFilters, setAppliedFilters] = useState(() => createDefaultFilters());
    const [visibleColumns, setVisibleColumns] = useState(() => loadVisibleColumns());
    const [showColumnPicker, setShowColumnPicker] = useState(false);
    const [data, setData] = useState({ logs: [], total: 0, limit: 20, offset: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [expandedRequestId, setExpandedRequestId] = useState(null);
    const [detailById, setDetailById] = useState({});
    const [detailLoadingId, setDetailLoadingId] = useState(null);
    const [detailErrorById, setDetailErrorById] = useState({});

    useEffect(() => {
        persistVisibleColumns(visibleColumns);
    }, [visibleColumns]);

    const loadLogs = useCallback(async (filters) => {
        setLoading(true);
        setError('');
        try {
            const range = buildRange(filters);
            const payload = await api.getChatRequestLogs(token, {
                fromTs: range.fromTs,
                toTs: range.toTs,
                requestId: filters.requestId || undefined,
                sessionId: filters.sessionId || undefined,
                userId: filters.userId || undefined,
                status: filters.status || 'all',
                limit: filters.limit,
                offset: filters.offset,
            });
            setData(payload);
        } catch (err) {
            if (err.message === 'Unauthorized') {
                setError('Session expired. Please log in again.');
                onSessionExpired();
                return;
            }
            setError(err.message || 'Failed to load chat bot analytics.');
        } finally {
            setLoading(false);
        }
    }, [token, onSessionExpired]);

    useEffect(() => {
        loadLogs(appliedFilters);
    }, [appliedFilters, loadLogs]);

    const totalPages = Math.max(1, Math.ceil((data.total || 0) / (appliedFilters.limit || 20)));
    const currentPage = Math.floor((appliedFilters.offset || 0) / (appliedFilters.limit || 20)) + 1;

    const summary = useMemo(() => {
        const presetLabels = {
            '24h': 'Last 24 hours',
            '7d': 'Last 7 days',
            '30d': 'Last 30 days',
            custom: `${appliedFilters.startDate || '—'} to ${appliedFilters.endDate || '—'}`,
        };
        return presetLabels[appliedFilters.preset] || presetLabels.custom;
    }, [appliedFilters]);

    const activeColumns = useMemo(
        () => COLUMN_OPTIONS.filter((option) => visibleColumns.includes(option.id)),
        [visibleColumns]
    );

    const detailColSpan = activeColumns.length + 1;

    const applyFilters = () => {
        if (draftFilters.preset === 'custom' && draftFilters.startDate && draftFilters.endDate && draftFilters.startDate > draftFilters.endDate) {
            setError('From date must be on or before to date.');
            return;
        }
        setExpandedRequestId(null);
        setAppliedFilters({ ...draftFilters, offset: 0 });
    };

    const resetFilters = () => {
        const defaults = createDefaultFilters();
        setDraftFilters(defaults);
        setExpandedRequestId(null);
        setAppliedFilters(defaults);
    };

    const resetColumns = () => {
        setVisibleColumns(DEFAULT_COLUMNS);
    };

    const toggleColumn = (columnId) => {
        if (REQUIRED_COLUMNS.includes(columnId)) return;
        setVisibleColumns((current) => {
            if (current.includes(columnId)) {
                return current.filter((value) => value !== columnId);
            }
            const next = COLUMN_OPTIONS
                .map((option) => option.id)
                .filter((value) => current.includes(value) || value === columnId);
            REQUIRED_COLUMNS.forEach((requiredId) => {
                if (!next.includes(requiredId)) next.push(requiredId);
            });
            return next;
        });
    };

    const changePage = (nextPage) => {
        const boundedPage = Math.min(Math.max(1, nextPage), totalPages);
        setAppliedFilters((prev) => ({
            ...prev,
            offset: (boundedPage - 1) * prev.limit,
        }));
    };

    const changePageSize = (nextLimit) => {
        const normalizedLimit = Number(nextLimit) || 20;
        setDraftFilters((prev) => ({ ...prev, limit: normalizedLimit }));
        setAppliedFilters((prev) => ({
            ...prev,
            limit: normalizedLimit,
            offset: 0,
        }));
    };

    const toggleExpand = async (requestId) => {
        if (expandedRequestId === requestId) {
            setExpandedRequestId(null);
            return;
        }
        setExpandedRequestId(requestId);
        if (detailById[requestId] || detailLoadingId === requestId) return;

        setDetailLoadingId(requestId);
        setDetailErrorById((prev) => ({ ...prev, [requestId]: '' }));
        try {
            const detail = await api.getChatRequestLogDetail(token, requestId);
            setDetailById((prev) => ({ ...prev, [requestId]: detail }));
        } catch (err) {
            if (err.message === 'Unauthorized') {
                onSessionExpired();
                return;
            }
            setDetailErrorById((prev) => ({ ...prev, [requestId]: err.message || 'Failed to load request details.' }));
        } finally {
            setDetailLoadingId((current) => (current === requestId ? null : current));
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Chat Bot Analytics</h2>
                    <p className="mt-0.5 text-sm text-slate-500">Paginated request logs for the chat bot, newest first.</p>
                </div>
                <div className="flex items-center gap-3">
                    <p className="text-sm text-slate-500">{summary}</p>
                    <button
                        onClick={() => loadLogs(appliedFilters)}
                        disabled={loading}
                        className="text-sm text-slate-600 hover:text-slate-900 border border-slate-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </button>
                </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-end gap-4">
                    <div>
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Range</span>
                        <select
                            value={draftFilters.preset}
                            onChange={(e) => setDraftFilters((prev) => ({ ...prev, preset: e.target.value }))}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        >
                            <option value="24h">Last 24 Hours</option>
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                            <option value="custom">Custom Range</option>
                        </select>
                    </div>

                    {draftFilters.preset === 'custom' && (
                        <>
                            <div>
                                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">From</span>
                                <input
                                    type="date"
                                    value={draftFilters.startDate}
                                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, startDate: e.target.value }))}
                                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                                />
                            </div>
                            <div>
                                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">To</span>
                                <input
                                    type="date"
                                    value={draftFilters.endDate}
                                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, endDate: e.target.value }))}
                                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                                />
                            </div>
                        </>
                    )}

                    <div>
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Request ID</span>
                        <input
                            type="text"
                            value={draftFilters.requestId}
                            onChange={(e) => setDraftFilters((prev) => ({ ...prev, requestId: e.target.value }))}
                            placeholder="Filter by request"
                            className="w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        />
                    </div>

                    <div>
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Session ID</span>
                        <input
                            type="text"
                            value={draftFilters.sessionId}
                            onChange={(e) => setDraftFilters((prev) => ({ ...prev, sessionId: e.target.value }))}
                            placeholder="Filter by session"
                            className="w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        />
                    </div>

                    <div>
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">User ID</span>
                        <input
                            type="text"
                            value={draftFilters.userId}
                            onChange={(e) => setDraftFilters((prev) => ({ ...prev, userId: e.target.value }))}
                            placeholder="Filter by user"
                            className="w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        />
                    </div>

                    <div>
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Status</span>
                        <select
                            value={draftFilters.status}
                            onChange={(e) => setDraftFilters((prev) => ({ ...prev, status: e.target.value }))}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        >
                            <option value="all">All</option>
                            <option value="success">Successful</option>
                            <option value="failed">Failed</option>
                        </select>
                    </div>

                    <div className="flex items-end gap-2">
                        <button
                            onClick={applyFilters}
                            disabled={loading}
                            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                            {loading ? 'Loading…' : 'Apply'}
                        </button>
                        <button
                            onClick={resetFilters}
                            disabled={loading}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                        >
                            Reset
                        </button>
                    </div>
                </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-slate-800">Requests</h3>
                        <p className="mt-1 text-sm text-slate-500">
                            {data.total === 0
                                ? 'No matching requests.'
                                : `Showing ${appliedFilters.offset + 1}–${Math.min(appliedFilters.offset + (data.logs || []).length, data.total)} of ${data.total.toLocaleString()} · click a row to expand`}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setShowColumnPicker((current) => !current)}
                                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                            >
                                Columns
                            </button>
                            {showColumnPicker && (
                                <div className="absolute right-0 z-10 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Visible Columns</div>
                                    <div className="space-y-2">
                                        {COLUMN_OPTIONS.map((option) => (
                                            <label key={option.id} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                                                <span>{option.label}</span>
                                                <input
                                                    type="checkbox"
                                                    checked={visibleColumns.includes(option.id)}
                                                    disabled={Boolean(option.locked)}
                                                    onChange={() => toggleColumn(option.id)}
                                                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                                />
                                            </label>
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={resetColumns}
                                        className="mt-3 text-sm font-medium text-sky-700 hover:text-sky-800"
                                    >
                                        Reset columns
                                    </button>
                                </div>
                            )}
                        </div>

                        <label className="flex items-center gap-2 text-sm text-slate-600">
                            <span>Rows</span>
                            <select
                                value={appliedFilters.limit}
                                onChange={(e) => changePageSize(e.target.value)}
                                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                            >
                                {PAGE_SIZE_OPTIONS.map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>

                {loading && !data.logs?.length ? (
                    <div className="px-4 py-8 text-sm text-slate-500">Loading chat bot request logs…</div>
                ) : data.total === 0 ? (
                    <div className="px-4 py-8 text-sm text-slate-500">No requests match the current filters.</div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="min-w-[960px] w-full table-fixed">
                                <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50">
                                        {visibleColumns.includes('created') && (
                                            <th className="w-44 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Created</th>
                                        )}
                                        {visibleColumns.includes('request') && (
                                            <th className="w-28 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Request</th>
                                        )}
                                        {visibleColumns.includes('session') && (
                                            <th className="w-28 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Session</th>
                                        )}
                                        {visibleColumns.includes('user') && (
                                            <th className="w-28 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">User</th>
                                        )}
                                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Question</th>
                                        <th className="w-24 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                                        <th className="w-24 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Latency</th>
                                        <th className="w-8 px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {(data.logs || []).map((row) => {
                                        const expanded = expandedRequestId === row.request_id;
                                        return (
                                            <React.Fragment key={row.request_id}>
                                                <tr
                                                    onClick={() => toggleExpand(row.request_id)}
                                                    className="cursor-pointer transition-colors hover:bg-slate-50"
                                                >
                                                    {visibleColumns.includes('created') && (
                                                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{formatTimestamp(row.created_at)}</td>
                                                    )}
                                                    {visibleColumns.includes('request') && (
                                                        <td className="px-4 py-3 text-sm font-medium text-slate-800 whitespace-nowrap">
                                                            <span className="font-mono" title={row.request_id || ''}>{formatCompactId(row.request_id)}</span>
                                                        </td>
                                                    )}
                                                    {visibleColumns.includes('session') && (
                                                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                                                            <span className="font-mono" title={row.session_id || ''}>{formatCompactId(row.session_id)}</span>
                                                        </td>
                                                    )}
                                                    {visibleColumns.includes('user') && (
                                                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                                                            <span className="font-mono" title={row.user_id || ''}>{formatCompactId(row.user_id)}</span>
                                                        </td>
                                                    )}
                                                    <td className="px-4 py-3 text-sm text-slate-800">
                                                        <div
                                                            title={row.question || ''}
                                                            className="overflow-hidden text-ellipsis"
                                                            style={{
                                                                display: '-webkit-box',
                                                                WebkitLineClamp: 2,
                                                                WebkitBoxOrient: 'vertical',
                                                                wordBreak: 'break-word',
                                                            }}
                                                        >
                                                            {row.question || '—'}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                                                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{formatLatency(row.latency_ms)}</td>
                                                    <td className="px-4 py-3 text-center text-slate-400">
                                                        <span className={`inline-block text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                                                    </td>
                                                </tr>
                                                {expanded && (
                                                    <tr>
                                                        <td colSpan={detailColSpan} className="p-0">
                                                            <ExpandedRequestDetail
                                                                detail={detailById[row.request_id]}
                                                                loading={detailLoadingId === row.request_id}
                                                                error={detailErrorById[row.request_id]}
                                                            />
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
                            <span>Page {currentPage} of {totalPages}</span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => changePage(currentPage - 1)}
                                    disabled={currentPage === 1}
                                    className="rounded-md border border-slate-300 px-3 py-1.5 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={() => changePage(currentPage + 1)}
                                    disabled={currentPage === totalPages}
                                    className="rounded-md border border-slate-300 px-3 py-1.5 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ChatBotAnalytics;
