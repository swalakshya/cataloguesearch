import React, { useEffect, useState } from 'react';
const valid = value => Number.isFinite(value) && value >= 0;
const seconds = ms => `${(ms / 1000).toFixed(1)}s`;

// One shared, quiet elapsed-time label for search and each chat answer.
export function OperationTiming({ kind = 'chat', timings, running = false, startedAt, label }) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!running) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [running, startedAt]);
    if (running) {
        const elapsed = valid(startedAt) ? ` ${Math.max(0, Math.floor((now - startedAt) / 1000))}s` : '';
        return <div className="text-xs text-ink-muted">{label || (kind === 'search' ? 'Searching' : 'Preparing answer')}…{elapsed}</div>;
    }
    if (!valid(timings?.total_ms)) return null;
    return <div className="mb-3 text-xs text-ink-muted py-1">
        {kind === 'search' ? 'Searched' : 'Completed'} in {seconds(timings.total_ms)}
    </div>;
}
