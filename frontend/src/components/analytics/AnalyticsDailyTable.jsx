import React from 'react';

const fmtSec = (v) => (v == null ? '—' : `${(v / 1000).toFixed(1)}s`);

const AnalyticsDailyTable = ({ rows }) => (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-lg font-semibold text-slate-800">Daily Breakdown</h3>
            <p className="mt-1 text-sm text-slate-500">Daily query volume and latency percentiles for the selected window.</p>
        </div>

        {rows.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-500">No analytics rows matched this date range.</div>
        ) : (
            <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem]">
                    <thead>
                        <tr className="bg-slate-50">
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Queries</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Avg</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">P50</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">P95</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">P99</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map(row => (
                            <tr key={row.date}>
                                <td className="px-4 py-3 text-sm font-medium text-slate-800">{row.date}</td>
                                <td className="px-4 py-3 text-sm text-slate-600">{row.count.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-slate-600">{fmtSec(row.avg)}</td>
                                <td className="px-4 py-3 text-sm text-slate-600">{fmtSec(row.p50)}</td>
                                <td className="px-4 py-3 text-sm text-slate-600">{fmtSec(row.p95)}</td>
                                <td className="px-4 py-3 text-sm text-slate-600">{fmtSec(row.p99)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
    </div>
);

export default AnalyticsDailyTable;
