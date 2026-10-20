import React, { useEffect, useState } from 'react';
import { api, Card } from '../JobUI';
import TestStatus from './TestStatus';
import LiveLogViewer from '../logviewer/LiveLogViewer';
export default function TestFileDetails({ run, file }) {
    const [details, setDetails] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let disposed = false;
        const controller = new AbortController();
        setDetails(null); setError('');
        const load = async () => {
            try {
                const data = await api(`/testing/runs/${run}/files/${file.id}`, { signal: controller.signal });
                if (!disposed) { setDetails(data); setError(''); }
            } catch (e) { if (!disposed) setError(e.message); }
        };
        load(); const timer = setInterval(load, 3000);
        return () => { disposed = true; controller.abort(); clearInterval(timer); };
    }, [run, file.id]);
    return <Card title={`${file.suite} · ${file.path === '__setup__' ? 'Suite setup / runner output' : file.path}`} right={<TestStatus status={file.status} />}>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {file.reason && <p className="text-sm text-amber-700 mb-2">{file.reason}</p>}
        <div className="max-h-64 overflow-auto mb-3">{details?.cases.map(c => <details key={c.name} className="text-xs border-b py-2"><summary className="cursor-pointer"><TestStatus status={{ passed: 'succeeded', failed: 'failed', skipped: 'skipped' }[c.status]} /> <span className="break-all">{c.name}</span> · {c.duration.toFixed(2)}s</summary>{c.text && <pre className="whitespace-pre-wrap mt-2">{c.text}</pre>}</details>)}</div>
        <LiveLogViewer path={`/testing/runs/${run}/files/${file.id}/logs`} label="Selected test file logs" empty="No output for this file yet. Setup and runner output are in the suite setup row." />
    </Card>;
}
