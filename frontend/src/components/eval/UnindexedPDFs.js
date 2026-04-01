import React, { useState, useEffect, useCallback } from 'react';

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

const STATUS_CONFIG = {
    never_indexed: { label: 'Never Indexed', className: 'bg-red-100 text-red-800',       activeClass: 'bg-red-600 text-white border-red-600' },
    ocr_only:      { label: 'OCR Only',      className: 'bg-yellow-100 text-yellow-800',  activeClass: 'bg-yellow-500 text-white border-yellow-500' },
    stale:         { label: 'Stale',          className: 'bg-orange-100 text-orange-800',  activeClass: 'bg-orange-500 text-white border-orange-500' },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG);

const StatusBadge = ({ status }) => {
    const cfg = STATUS_CONFIG[status] || { label: status, className: 'bg-slate-100 text-slate-700' };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.className}`}>
            {cfg.label}
        </span>
    );
};

// Collapsed sub-sections inside an expanded PDF row
const SubSectionsCell = ({ subSections }) => {
    const [open, setOpen] = useState(false);
    if (!subSections) return <span className="text-slate-400 italic text-xs">—</span>;

    const nonIndexed = subSections.filter(s => s.status !== 'indexed');
    const indexed    = subSections.filter(s => s.status === 'indexed');

    return (
        <div>
            <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900"
            >
                <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
                     fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span>
                    {nonIndexed.length} pending
                    {indexed.length > 0 && <span className="text-slate-400"> · {indexed.length} indexed</span>}
                </span>
            </button>
            {open && (
                <div className="mt-1.5 space-y-0.5 pl-1">
                    {nonIndexed.map((s, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs">
                            <StatusBadge status={s.status} />
                            <span className="text-slate-700">{s.name}</span>
                        </div>
                    ))}
                    {indexed.length > 0 && (
                        <div className="text-xs text-slate-400 mt-1">+ {indexed.length} already indexed</div>
                    )}
                </div>
            )}
        </div>
    );
};

// One row per scan_config_dir group — collapses its PDF list
const ScanConfigGroup = ({ group, activeStatuses }) => {
    const [open, setOpen] = useState(false);

    const { scan_config_dir, worst_status, pdfs } = group;

    // Last path segment(s) as the display label; full path as secondary
    const dirParts = scan_config_dir.replace(/\\/g, '/').split('/');
    const label = dirParts.slice(-2).join('/');    // e.g. "1968" or "Samaysaar/1968"
    const fullPath = scan_config_dir.replace(/\\/g, '/');

    const visiblePdfs = pdfs.filter(p => activeStatuses.has(p.status) || p.status === 'indexed');
    // Always show indexed as context, but hide a group if no actively-filtered statuses are present
    const hasActiveStatus = pdfs.some(p => activeStatuses.has(p.status));
    if (!hasActiveStatus) return null;

    const nonIndexed = pdfs.filter(p => p.status !== 'indexed');
    const indexed    = pdfs.filter(p => p.status === 'indexed');

    // Count by status among non-indexed
    const statusCounts = nonIndexed.reduce((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
    }, {});

    return (
        <tr className="border-t border-slate-100 align-top">
            {/* Directory label */}
            <td className="px-4 py-3">
                <button
                    onClick={() => setOpen(o => !o)}
                    className="flex items-start gap-1.5 text-left w-full group"
                >
                    <svg className={`w-3.5 h-3.5 mt-0.5 text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
                         fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div>
                        <div className="font-medium text-slate-800 group-hover:text-sky-700">{label}</div>
                        {dirParts.length > 2 && (
                            <div className="font-mono text-xs text-slate-400 mt-0.5">{fullPath}</div>
                        )}
                    </div>
                </button>
            </td>

            {/* Worst status */}
            <td className="px-4 py-3 whitespace-nowrap">
                <StatusBadge status={worst_status} />
            </td>

            {/* Files summary */}
            <td className="px-4 py-3 text-xs text-slate-600">
                <div className="flex flex-wrap gap-1.5 mb-1">
                    {Object.entries(statusCounts).map(([st, cnt]) => (
                        <span key={st} className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_CONFIG[st]?.className || ''}`}>
                            {cnt} {STATUS_CONFIG[st]?.label || st}
                        </span>
                    ))}
                    {indexed.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-500">
                            {indexed.length} indexed
                        </span>
                    )}
                </div>

                {/* Expanded PDF list */}
                {open && (
                    <div className="mt-2 border border-slate-200 rounded overflow-hidden">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-slate-400 uppercase tracking-wider">
                                <tr>
                                    <th className="px-3 py-1.5 text-left font-medium">File</th>
                                    <th className="px-3 py-1.5 text-left font-medium">Status</th>
                                    <th className="px-3 py-1.5 text-left font-medium">Sub-sections</th>
                                    <th className="px-3 py-1.5 text-left font-medium">Last Indexed</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {visiblePdfs.map((pdf, i) => (
                                    <tr key={i} className={`align-top ${pdf.status === 'indexed' ? 'opacity-40' : ''}`}>
                                        <td className="px-3 py-2 font-medium text-slate-800 max-w-xs break-words">
                                            {pdf.filename}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            <StatusBadge status={pdf.status} />
                                        </td>
                                        <td className="px-3 py-2">
                                            <SubSectionsCell subSections={pdf.sub_sections} />
                                        </td>
                                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                                            {pdf.last_indexed
                                                ? new Date(pdf.last_indexed).toLocaleDateString()
                                                : <span className="italic text-slate-400">Never</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </td>

            {/* Last indexed (most recent among non-indexed group) */}
            <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                {(() => {
                    const dates = pdfs
                        .filter(p => p.last_indexed)
                        .map(p => p.last_indexed)
                        .sort()
                        .reverse();
                    return dates.length
                        ? new Date(dates[0]).toLocaleDateString()
                        : <span className="italic text-slate-400">Never</span>;
                })()}
            </td>
        </tr>
    );
};

const CategorySection = ({ category, groups, activeStatuses }) => {
    const [collapsed, setCollapsed] = useState(false);

    // Count visible groups (those with at least one actively-filtered status)
    const visibleGroups = groups.filter(g => g.pdfs.some(p => activeStatuses.has(p.status)));
    if (visibleGroups.length === 0) return null;

    // Aggregate status counts across all PDFs in this category
    const statusCounts = {};
    groups.forEach(g => g.pdfs.forEach(p => {
        if (p.status !== 'indexed') statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
    }));

    return (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <button
                onClick={() => setCollapsed(c => !c)}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors text-left"
            >
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-base font-semibold text-slate-800">{category}</span>
                    <span className="text-sm text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                        {visibleGroups.length}{visibleGroups.length !== groups.length && `/${groups.length}`} groups
                    </span>
                    {Object.entries(statusCounts).map(([st, cnt]) => (
                        <span key={st} className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CONFIG[st]?.className || 'bg-slate-100 text-slate-600'}`}>
                            {cnt} {STATUS_CONFIG[st]?.label || st}
                        </span>
                    ))}
                </div>
                <svg className={`w-5 h-5 text-slate-400 transition-transform flex-shrink-0 ${collapsed ? '-rotate-90' : ''}`}
                     fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {!collapsed && (
                <div className="border-t border-slate-200 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="px-4 py-2 text-left font-medium w-64">Directory</th>
                                <th className="px-4 py-2 text-left font-medium">Status</th>
                                <th className="px-4 py-2 text-left font-medium">Files</th>
                                <th className="px-4 py-2 text-left font-medium">Last Indexed</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleGroups.map((group, i) => (
                                <ScanConfigGroup key={i} group={group} activeStatuses={activeStatuses} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

const UnindexedPDFs = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [activeStatuses, setActiveStatuses] = useState(new Set(ALL_STATUSES));

    const toggleStatus = (status) => {
        setActiveStatuses(prev => {
            const next = new Set(prev);
            if (next.has(status)) {
                if (next.size > 1) next.delete(status);
            } else {
                next.add(status);
            }
            return next;
        });
    };

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE_URL}/eval/unindexed-pdfs`);
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            setData(await res.json());
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Total non-indexed PDFs across all groups
    const totalPdfs = data
        ? Object.values(data).flat().reduce((sum, g) => sum + g.pdfs.filter(p => p.status !== 'indexed').length, 0)
        : 0;
    const visiblePdfs = data
        ? Object.values(data).flat().reduce((sum, g) => sum + g.pdfs.filter(p => activeStatuses.has(p.status)).length, 0)
        : 0;
    const totalGroups = data ? Object.values(data).flat().length : 0;

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-800">Unindexed PDFs</h2>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Grouped by scan_config.json directory. Expand a group to see individual files.
                        </p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        {data && (
                            <span className="text-sm text-slate-600">
                                <span className="font-semibold text-slate-800">
                                    {visiblePdfs}{visiblePdfs !== totalPdfs && `/${totalPdfs}`}
                                </span> PDFs in{' '}
                                <span className="font-semibold text-slate-800">{totalGroups}</span> groups
                            </span>
                        )}
                        <button
                            onClick={load}
                            disabled={loading}
                            className="flex items-center gap-2 bg-sky-600 text-white text-sm font-medium px-3 py-1.5 rounded-md hover:bg-sky-700 disabled:opacity-50 transition-colors"
                        >
                            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {loading ? 'Scanning...' : 'Refresh'}
                        </button>
                    </div>
                </div>

                {/* Filter toggles */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <span className="text-xs text-slate-500 font-medium">Show:</span>
                    {ALL_STATUSES.map(status => {
                        const cfg = STATUS_CONFIG[status];
                        const isActive = activeStatuses.has(status);
                        return (
                            <button
                                key={status}
                                onClick={() => toggleStatus(status)}
                                className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                                    isActive
                                        ? cfg.activeClass
                                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'
                                }`}
                            >
                                {cfg.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm">
                    Failed to load: {error}
                </div>
            )}

            {loading && !data && (
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="bg-white rounded-lg border border-slate-200 p-4 animate-pulse">
                            <div className="h-4 bg-slate-200 rounded w-32 mb-2" />
                            <div className="h-3 bg-slate-100 rounded w-48" />
                        </div>
                    ))}
                </div>
            )}

            {data && totalGroups === 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
                    <svg className="w-12 h-12 text-green-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-green-800 font-medium">All PDFs are indexed and up to date.</p>
                </div>
            )}

            {data && totalGroups > 0 && (
                <div className="space-y-3">
                    {Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([category, groups]) => (
                        <CategorySection
                            key={category}
                            category={category}
                            groups={groups}
                            activeStatuses={activeStatuses}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default UnindexedPDFs;
