import React, { useEffect, useRef, useState } from 'react';
import { postJson } from '../JobUI';
import useServicePolling from './useServicePolling';

export default function ServiceConfiguration({ service, revision }) {
    const { data: config, error: fetchError } = useServicePolling(`/local-services/${service}/config`, { revision });
    const [revealed, setRevealed] = useState({});
    const [query, setQuery] = useState('');
    const [error, setError] = useState('');
    const generation = useRef(0);
    useEffect(() => {
        generation.current += 1;
        setRevealed({});
        setError('');
        return () => { generation.current += 1; };
    }, [service, revision]);
    useEffect(() => {
        if (!Object.keys(revealed).length) return;
        const timer = setTimeout(() => { generation.current += 1; setRevealed({}); }, 30000);
        return () => clearTimeout(timer);
    }, [revealed]);
    const show = async key => {
        if (key in revealed) {
            generation.current += 1;
            setRevealed(old => { const copy = { ...old }; delete copy[key]; return copy; });
            return;
        }
        const started = generation.current;
        try {
            const data = await postJson(`/local-services/${service}/config/reveal`, { key });
            if (started === generation.current) setRevealed(old => ({ ...old, [key]: data.value }));
        } catch (err) { if (started === generation.current) setError(err.message); }
    };
    return <>
        {(fetchError || error) && <p role="alert" className="text-sm text-red-700 mb-2">{fetchError || error}</p>}
        {config ? <div className="space-y-3">
            <p className="text-xs text-slate-500">{config.note}</p>
            <div className="text-xs break-words text-slate-600">Directory: {config.directory}<br />Sources: {config.sources.join(', ')}</div>
            <details><summary className="text-xs cursor-pointer text-slate-600">Startup command</summary><pre className="text-xs whitespace-pre-wrap break-words">{config.command.join(' ')}</pre></details>
            <input aria-label="Search configuration" placeholder="Search setting names" value={query} onChange={e => setQuery(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
            <div className="max-h-96 overflow-auto divide-y divide-slate-100">{config.values.filter(row => row.key.toLowerCase().includes(query.toLowerCase())).map(row => <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 py-2 text-xs">
                <span className="font-mono break-words text-slate-600">{row.key}</span>
                <div className="flex gap-2 items-start min-w-0"><span className="font-mono whitespace-pre-wrap break-all">{String(row.key in revealed ? revealed[row.key] : row.value ?? '')}</span>
                    {row.secret && row.value && <button aria-label={`${row.key in revealed ? 'Hide' : 'Show'} ${row.key}`} className="text-blue-700 shrink-0" onClick={() => show(row.key)}>{row.key in revealed ? 'Hide' : 'Show'}</button>}
                </div>
            </div>)}</div>
            <p className="text-xs text-slate-500">Shown secrets hide after 30 seconds or when you close this view.</p>
        </div> : <p className="text-sm text-slate-500">Loading configuration…</p>}
    </>;
}
