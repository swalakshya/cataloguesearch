import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import AnalyticsDailyTable from './AnalyticsDailyTable';
import AnalyticsFilters from './AnalyticsFilters';
import AnalyticsQueriesTable from './AnalyticsQueriesTable';
import AnalyticsStatCard from './AnalyticsStatCard';

const formatDateInput = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const createDefaultFilters = () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    return {
        fromDate: formatDateInput(yesterday),
        toDate: formatDateInput(today),
        source: ['search', 'agent'],
        language: '',
        minHits: 0,
        maxHits: 1000,
    };
};

const buildStatCards = (analytics) => [
    { label: 'Total Queries', value: analytics.total, unit: 'count', tone: 'sky' },
    { label: 'Latency Avg', value: analytics.latency?.avg, unit: 'ms', tone: 'sky' },
    { label: 'Latency P95', value: analytics.latency?.p95, unit: 'ms', tone: 'sky' },
    { label: 'Latency P99', value: analytics.latency?.p99, unit: 'ms', tone: 'amber' },
    { label: 'TTFB Avg', value: analytics.ttfb?.avg, unit: 'ms', tone: 'emerald' },
    { label: 'TTFB P95', value: analytics.ttfb?.p95, unit: 'ms', tone: 'emerald' },
    { label: 'TTFB P99', value: analytics.ttfb?.p99, unit: 'ms', tone: 'amber' },
];

const AnalyticsDashboard = ({ token, onSessionExpired }) => {
    const [draftFilters, setDraftFilters] = useState(() => createDefaultFilters());
    const [appliedFilters, setAppliedFilters] = useState(() => createDefaultFilters());
    const [analytics, setAnalytics] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const loadAnalytics = useCallback(async (filters) => {
        setLoading(true);
        setError('');

        try {
            const data = await api.getAnalytics(token, filters);
            setAnalytics(data);
        } catch (err) {
            if (err.message === 'Unauthorized') {
                setError('Session expired. Please log in again.');
                onSessionExpired();
                return;
            }
            setError(err.message || 'Failed to load analytics.');
        } finally {
            setLoading(false);
        }
    }, [token, onSessionExpired]);

    useEffect(() => {
        loadAnalytics(createDefaultFilters());
    }, [loadAnalytics]);

    const handleApply = () => {
        if (draftFilters.fromDate && draftFilters.toDate && draftFilters.fromDate > draftFilters.toDate) {
            setError('From date must be on or before to date.');
            return;
        }
        setAppliedFilters(draftFilters);
        loadAnalytics(draftFilters);
    };

    const handleReset = () => {
        const defaults = createDefaultFilters();
        setDraftFilters(defaults);
        setAppliedFilters(defaults);
        loadAnalytics(defaults);
    };

    const summary = useMemo(() => {
        const src = appliedFilters.source;
        const sourceLabel = (!src || src.length === 0) ? 'all sources' : src.join(', ');
        const langLabel = appliedFilters.language ? ` · ${appliedFilters.language}` : '';
        return `${appliedFilters.fromDate} to ${appliedFilters.toDate} · ${sourceLabel}${langLabel}`;
    }, [appliedFilters]);

    const statCards = useMemo(
        () => (analytics ? buildStatCards(analytics) : []),
        [analytics]
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Analytics</h2>
                    <p className="text-sm text-slate-500 mt-0.5">Latency, TTFB, and raw query logs for the selected time window.</p>
                </div>
                <p className="text-sm text-slate-500">{loading && analytics ? 'Refreshing…' : summary}</p>
            </div>

            <AnalyticsFilters
                filters={draftFilters}
                onChange={setDraftFilters}
                onApply={handleApply}
                onReset={handleReset}
                loading={loading}
                availableSources={analytics?.sources || ['search', 'agent']}
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            {!analytics && loading ? (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500 shadow-sm">
                    Loading analytics…
                </div>
            ) : analytics && (
                <>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {statCards.map(card => (
                            <AnalyticsStatCard
                                key={card.label}
                                label={card.label}
                                value={card.value}
                                unit={card.unit}
                                tone={card.tone}
                            />
                        ))}
                    </div>

                    <AnalyticsDailyTable rows={analytics.by_day || []} />
                    <AnalyticsQueriesTable queries={analytics.queries || []} />
                </>
            )}
        </div>
    );
};

export default AnalyticsDashboard;
