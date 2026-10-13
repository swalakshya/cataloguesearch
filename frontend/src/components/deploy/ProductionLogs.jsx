import React, { useEffect, useRef, useState } from 'react';
import { api, Card } from '../dev/JobUI';

export default function ProductionLogs() {
    const [service, setService] = useState('chat');
    const [since, setSince] = useState('15m');
    const [lines, setLines] = useState('200');
    const [live, setLive] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [stick, setStick] = useState(true);
    const box = useRef(null);
    const selection = `${service}:${since}:${lines}`;

    useEffect(() => {
        let alive = true;
        let timer;
        let controller;
        setError('');
        const tick = async () => {
            controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 35000);
            setLoading(true);
            try {
                const data = await api(`/deploy/production/logs?service=${service}&lines=${lines}&since=${since}`, { signal: controller.signal });
                if (!alive) return;
                if (!data.reachable) throw new Error(data.error || 'Production logs unavailable');
                setResult({ ...data, selection });
                setError('');
            } catch (err) {
                if (alive) setError(err.name === 'AbortError' ? 'Log request timed out' : err.message);
            } finally {
                clearTimeout(timeout);
                if (alive) {
                    setLoading(false);
                    if (live) timer = setTimeout(tick, 3000);
                }
            }
        };
        tick();
        return () => { alive = false; clearTimeout(timer); controller?.abort(); };
    }, [service, since, lines, live, refresh, selection]);

    useEffect(() => {
        if (stick && box.current) box.current.scrollTop = box.current.scrollHeight;
    }, [result, stick]);

    const shown = result?.selection === selection ? result : null;
    const control = 'rounded border border-slate-300 px-2 py-1 text-sm bg-white';
    return <Card title="Production logs" right={<span className="text-xs text-slate-500">Read-only</span>}>
        <div className="flex flex-wrap items-end gap-3 mb-3">
            <label className="text-xs text-slate-600 flex flex-col gap-1">Service
                <select aria-label="Log service" value={service} onChange={event => setService(event.target.value)} className={control}>
                    <option value="chat">Chat</option><option value="api">API</option>
                    <option value="frontend">Frontend</option><option value="opensearch">OpenSearch</option>
                </select>
            </label>
            <label className="text-xs text-slate-600 flex flex-col gap-1">Time range
                <select aria-label="Log time range" value={since} onChange={event => setSince(event.target.value)} className={control}>
                    <option value="5m">Last 5 minutes</option><option value="15m">Last 15 minutes</option>
                    <option value="1h">Last hour</option><option value="24h">Last 24 hours</option>
                </select>
            </label>
            <label className="text-xs text-slate-600 flex flex-col gap-1">Maximum lines
                <select aria-label="Log line limit" value={lines} onChange={event => setLines(event.target.value)} className={control}>
                    <option value="100">100</option><option value="200">200</option><option value="500">500</option>
                </select>
            </label>
            <button disabled={loading} onClick={() => setRefresh(value => value + 1)} className={`${control} cursor-pointer disabled:opacity-50`}>Refresh logs</button>
            <label className="text-sm flex items-center gap-1.5 py-1"><input type="checkbox" checked={live} onChange={event => setLive(event.target.checked)} />Live updates</label>
            <label className="text-sm flex items-center gap-1.5 py-1"><input type="checkbox" checked={stick} onChange={event => setStick(event.target.checked)} />Scroll to latest</label>
        </div>
        <p className="text-xs text-slate-500 mb-2">Recent container output. Live updates refresh every 3 seconds while this tab is open. Log timestamps are UTC.</p>
        <p role="status" className="text-xs text-slate-500 mb-2">
            {loading ? 'Fetching logs…' : live ? 'Live updates on' : 'Live updates off'}
            {shown && ` · Last fetched ${new Date(shown.checked_at).toLocaleTimeString()}`}
            {shown && error && ' · Previous results'}
        </p>
        {error && <p role="alert" className="text-sm text-red-700 mb-2">Could not fetch logs: {error}</p>}
        {shown?.truncated && <p className="text-xs text-orange-700 mb-2">Output limited to the most recent 256 KiB. Choose a smaller time range or line limit.</p>}
        <pre ref={box} aria-label="Production log output" tabIndex={0}
            className="bg-slate-950 text-slate-100 rounded p-3 text-xs font-mono whitespace-pre-wrap break-words overflow-auto h-80">
            {shown ? shown.text || 'No logs in this time range.' : error ? 'Logs unavailable.' : 'Loading logs…'}
        </pre>
    </Card>;
}
