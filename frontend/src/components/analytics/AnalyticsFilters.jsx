import React from 'react';
import MultiSelectDropdown from './MultiSelectDropdown';

const SegmentedButtons = ({ options, value, onChange }) => (
    <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
        {options.map(([val, label]) => (
            <button
                key={val}
                type="button"
                onClick={() => onChange(val)}
                className={`px-3 py-2 transition-colors ${value === val ? 'bg-sky-600 text-white font-medium' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
                {label}
            </button>
        ))}
    </div>
);

const AnalyticsFilters = ({ filters, onChange, onApply, onReset, loading, availableSources = [] }) => {
    const set = (field, value) => onChange({ ...filters, [field]: value });

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap gap-4 items-end">

                <div className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">From</span>
                    <input
                        type="date"
                        value={filters.fromDate}
                        onChange={e => set('fromDate', e.target.value)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                    />
                </div>

                <div className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">To</span>
                    <input
                        type="date"
                        value={filters.toDate}
                        onChange={e => set('toDate', e.target.value)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                    />
                </div>

                <div className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Source</span>
                    <MultiSelectDropdown
                        label="All sources"
                        options={availableSources}
                        selected={Array.isArray(filters.source) ? filters.source : []}
                        onChange={val => set('source', val)}
                    />
                </div>

                <div className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Language</span>
                    <SegmentedButtons
                        options={[['', 'Both'], ['hindi', 'Hindi'], ['gujarati', 'Gujarati']]}
                        value={filters.language}
                        onChange={val => set('language', val)}
                    />
                </div>

                <div className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Results</span>
                    <div className="flex items-center gap-1.5">
                        <input
                            type="number"
                            min={0}
                            value={filters.minHits}
                            onChange={e => set('minHits', Math.max(0, Number(e.target.value)))}
                            className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                            placeholder="Min"
                        />
                        <span className="text-xs text-slate-400">–</span>
                        <input
                            type="number"
                            min={0}
                            value={filters.maxHits}
                            onChange={e => set('maxHits', Math.max(0, Number(e.target.value)))}
                            className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                            placeholder="Max"
                        />
                    </div>
                </div>

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
