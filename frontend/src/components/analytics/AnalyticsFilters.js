import React from 'react';

const AnalyticsFilters = ({ filters, onChange, onApply, onReset, loading }) => {
    const handleChange = (field, value) => {
        onChange({
            ...filters,
            [field]: value,
        });
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-4 md:grid-cols-4">
                <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">From Date</span>
                    <input
                        type="date"
                        value={filters.fromDate}
                        onChange={e => handleChange('fromDate', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                    />
                </label>

                <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">To Date</span>
                    <input
                        type="date"
                        value={filters.toDate}
                        onChange={e => handleChange('toDate', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                    />
                </label>

                <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Source</span>
                    <select
                        value={filters.source}
                        onChange={e => handleChange('source', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                    >
                        <option value="">All sources</option>
                        <option value="search">search</option>
                        <option value="agent">agent</option>
                    </select>
                </label>

                <div className="flex items-end gap-2">
                    <button
                        onClick={onApply}
                        disabled={loading}
                        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                        {loading ? 'Loading…' : 'Apply'}
                    </button>
                    <button
                        onClick={onReset}
                        disabled={loading}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                        Reset
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AnalyticsFilters;
