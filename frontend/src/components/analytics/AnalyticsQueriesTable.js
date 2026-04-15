import React, { useEffect, useMemo, useState } from 'react';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const fmtSec = (value) => (value === null || value === undefined ? '—' : `${(value / 1000).toFixed(1)}s`);

const SourceBadge = ({ source }) => (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        source === 'agent' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'
    }`}>
        {source}
    </span>
);

const DetailPill = ({ label, value }) => (
    <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs">
        <span className="font-medium text-slate-500">{label}</span>
        <span className="text-slate-800">{value}</span>
    </div>
);

const ExpandedDetail = ({ row }) => (
    <tr>
        <td colSpan={6} className="bg-slate-50 px-6 pb-3 pt-1">
            <div className="flex flex-wrap gap-2">
                <DetailPill label="Mode" value={row.search_mode} />
                <DetailPill label="Reranked" value={row.reranked ? 'yes' : 'no'} />
                <DetailPill label="Language" value={row.language} />
                <DetailPill label="Categories" value={row.categories} />
                <DetailPill label="Page size" value={row.page_size} />
                <DetailPill label="Page" value={row.page} />
                <DetailPill label="Hits" value={row.total_hits} />
                {row.query_id && <DetailPill label="Query ID" value={row.query_id} />}
            </div>
        </td>
    </tr>
);

const QueryRow = ({ row, index }) => {
    const [expanded, setExpanded] = useState(false);

    return (
        <>
            <tr
                onClick={() => setExpanded(e => !e)}
                className="cursor-pointer hover:bg-slate-50 transition-colors"
            >
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{row.timestamp}</td>
                <td className="px-4 py-3 whitespace-nowrap"><SourceBadge source={row.source} /></td>
                <td className="px-4 py-3 text-sm text-slate-800 max-w-sm">
                    <div className="truncate" title={row.query}>{row.query}</div>
                </td>
                <td className="px-4 py-3 text-sm font-medium text-slate-800 whitespace-nowrap">{fmtSec(row.latency_ms)}</td>
                <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{fmtSec(row.ttfb_ms)}</td>
                <td className="px-4 py-3 text-slate-400 text-center">
                    <span className={`inline-block transition-transform text-xs ${expanded ? 'rotate-90' : ''}`}>▶</span>
                </td>
            </tr>
            {expanded && <ExpandedDetail row={row} />}
        </>
    );
};

const AnalyticsQueriesTable = ({ queries }) => {
    const [pageSize, setPageSize] = useState(20);
    const [currentPage, setCurrentPage] = useState(1);
    const [filterSource, setFilterSource] = useState('');
    const [filterLang, setFilterLang] = useState('');

    const sortedQueries = useMemo(() => {
        const filtered = queries.filter(r => {
            if (filterSource && r.source !== filterSource) return false;
            if (filterLang && r.language !== filterLang) return false;
            return true;
        });
        return filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }, [queries, filterSource, filterLang]);

    const totalPages = Math.max(1, Math.ceil(sortedQueries.length / pageSize));
    const startIndex = (currentPage - 1) * pageSize;
    const pageRows = sortedQueries.slice(startIndex, startIndex + pageSize);

    useEffect(() => { setCurrentPage(1); }, [queries, pageSize, filterSource, filterLang]);
    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(totalPages);
    }, [currentPage, totalPages]);

    return (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-slate-800">Queries</h3>
                        <p className="mt-1 text-sm text-slate-500">
                            {sortedQueries.length === 0
                                ? 'No matching queries.'
                                : `Showing ${startIndex + 1}–${Math.min(startIndex + pageRows.length, sortedQueries.length)} of ${sortedQueries.length.toLocaleString()} · click a row to expand`}
                        </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                        <span>Rows</span>
                        <select
                            value={pageSize}
                            onChange={e => setPageSize(Number(e.target.value))}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        >
                            {PAGE_SIZE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                    </label>
                </div>
                <div className="flex flex-wrap gap-2">
                    {[
                        { label: 'Source', value: filterSource, onChange: setFilterSource, options: [['', 'All'], ['search', 'Search'], ['agent', 'Agent']] },
                        { label: 'Language', value: filterLang, onChange: setFilterLang, options: [['', 'Both'], ['hi', 'Hindi'], ['gu', 'Gujarati']] },
                    ].map(({ label, value, onChange, options }) => (
                        <div key={label} className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-slate-500">{label}</span>
                            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                                {options.map(([val, display]) => (
                                    <button
                                        key={val}
                                        type="button"
                                        onClick={() => onChange(val)}
                                        className={`px-3 py-1.5 transition-colors ${value === val ? 'bg-sky-600 text-white font-medium' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        {display}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {sortedQueries.length === 0 ? (
                <div className="px-4 py-8 text-sm text-slate-500">Try widening the date range or removing the source filter.</div>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Timestamp</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Source</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Query</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Latency</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">TTFB</th>
                                    <th className="px-4 py-3 w-8" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {pageRows.map((row, i) => (
                                    <QueryRow key={`${row.query_id}-${row.timestamp}-${i}`} row={row} index={i} />
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
                        <span>Page {currentPage} of {totalPages}</span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="rounded-md border border-slate-300 px-3 py-1.5 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                            >Previous</button>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="rounded-md border border-slate-300 px-3 py-1.5 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                            >Next</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AnalyticsQueriesTable;
