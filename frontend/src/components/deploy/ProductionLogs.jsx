import React, { useState } from 'react';
import { Card } from '../dev/JobUI';
import LiveLogViewer from '../dev/logviewer/LiveLogViewer';

export default function ProductionLogs() {
    const [service, setService] = useState('chat');
    const [since, setSince] = useState('15m');
    const [refresh, setRefresh] = useState(0);
    const path = `/deploy/production/logs?service=${service}&lines=10000&since=${since}`;
    const control = 'rounded border border-slate-300 px-2 py-1 text-sm bg-white';
    return <Card title="Production logs" right={<span className="text-xs text-slate-500">Read-only</span>}>
        <div className="flex flex-wrap items-end gap-3 mb-3">
            <label className="text-xs text-slate-600 flex flex-col gap-1">Service
                <select aria-label="Log service" value={service} onChange={event => setService(event.target.value)} className={control}>
                    <option value="chat">Chat</option><option value="api">API</option>
                    <option value="frontend">Frontend</option><option value="opensearch">OpenSearch</option>
                </select>
            </label>
            <label className="text-xs text-slate-600 flex flex-col gap-1">Initial history
                <select aria-label="Log time range" value={since} onChange={event => setSince(event.target.value)} className={control}>
                    <option value="5m">Last 5 minutes</option><option value="15m">Last 15 minutes</option>
                    <option value="1h">Last hour</option><option value="24h">Last 24 hours</option>
                </select>
            </label>
            <button onClick={() => setRefresh(value => value + 1)} className={`${control} cursor-pointer`}>Refresh logs</button>
        </div>
        <p className="text-xs text-slate-500 mb-2">Container timestamps are UTC. New output appends while this view is open.</p>
        <LiveLogViewer key={path} path={path} revision={refresh} label="Production log output" empty="No logs in this time range." />
    </Card>;
}
