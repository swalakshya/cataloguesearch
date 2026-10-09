import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const LABELS = { understanding: 'Understanding question', searching: 'Finding sources', preparing: 'Generating answer',
    embedding: 'Query embedding', retrieval: 'Retrieval', context: 'Surrounding context', reranking: 'Reranking' };
const valid = value => Number.isFinite(value) && value >= 0;
const seconds = ms => `${(ms / 1000).toFixed(1)}s`;

// One shared, quiet activity disclosure for search and each chat answer.
export function OperationTiming({ kind = 'chat', timings, running = false, startedAt, label }) {
    const [open, setOpen] = useState(false);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!running) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [running, startedAt]);
    useEffect(() => { setOpen(false); }, [startedAt, timings]);
    if (running) {
        const elapsed = valid(startedAt) ? ` ${Math.max(0, Math.floor((now - startedAt) / 1000))}s` : '';
        return <div className="text-xs text-ink-muted">{label || (kind === 'search' ? 'Searching' : 'Preparing answer')}…{elapsed}</div>;
    }
    if (!valid(timings?.total_ms)) return null;
    const entries = Object.entries(timings.operations || {}).filter(([key, value]) => LABELS[key] && valid(value));
    const nested = Object.entries(timings.search_work || {}).filter(([key, value]) => LABELS[key] && valid(value));
    const known = entries.reduce((sum, [, value]) => sum + value, 0);
    const other = Math.max(0, timings.total_ms - known);
    return <div className="mb-3 text-xs text-ink-muted">
        <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}
            className="inline-flex cursor-pointer items-center gap-1 py-1 hover:text-ink focus-visible:outline focus-visible:outline-brand rounded">
            {kind === 'search' ? 'Searched' : 'Completed'} in {seconds(timings.total_ms)}
            {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        </button>
        {open && <div className="mt-1 max-w-sm space-y-1 border-l border-border pl-3">
            {entries.map(([key, ms]) => <div key={key} className="flex justify-between gap-6"><span>{LABELS[key]}</span><span className="tabular-nums">{seconds(ms)}</span></div>)}
            {other >= 100 && <div className="flex justify-between gap-6"><span>Other processing</span><span className="tabular-nums">{seconds(other)}</span></div>}
            {nested.length > 0 && <div className="pt-2 space-y-1">
                <p>Within source search · accumulated work; parallel calls may overlap</p>
                {nested.map(([key, ms]) => <div key={key} className="flex justify-between gap-6"><span>{LABELS[key]}</span><span className="tabular-nums">{seconds(ms)}</span></div>)}
            </div>}
        </div>}
    </div>;
}
