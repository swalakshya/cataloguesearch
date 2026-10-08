import React from 'react';

const TONE_CLASSES = {
    sky: 'border-sky-200 bg-sky-50',
    amber: 'border-amber-200 bg-amber-50',
    emerald: 'border-emerald-200 bg-emerald-50',
};

const formatValue = (value, unit) => {
    if (value === null || value === undefined) return '—';
    if (unit === 'count') return value.toLocaleString();
    if (unit === 'ms') return `${(value / 1000).toFixed(1)}s`;
    return `${value.toLocaleString()} ${unit}`;
};

const AnalyticsStatCard = ({ label, value, unit = 'ms', tone = 'sky' }) => (
    <div className={`rounded-xl border p-4 shadow-sm ${TONE_CLASSES[tone] || TONE_CLASSES.sky}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-slate-900">{formatValue(value, unit)}</p>
    </div>
);

export default AnalyticsStatCard;
