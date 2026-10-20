import React, { useEffect, useState } from 'react';
import { api, postJson, PageShell, Card, StatusBadge, useJobs, BusyNotice, JobHistory, ErrorBanner } from '../JobUI';
import TestFileDetails from './TestFileDetails';
import CoverageView from './CoverageView';

import TestStatus, { FILE_STATUSES, STATUS_ORDER } from './TestStatus';
import SuiteSummary from './SuiteSummary';

export default function TestingPage() {
    const jobs = useJobs('testing');
    const [inventory, setInventory] = useState(null);
    const [report, setReport] = useState(null);
    const [selected, setSelected] = useState(null);
    const [suite, setSuite] = useState('all');
    const [view, setView] = useState('tests');
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('all');
    const [coverage, setCoverage] = useState(null);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState('');
    const run = jobs.selectedRunId;
    useEffect(() => {
        const controller = new AbortController();
        api('/testing', { signal: controller.signal }).then(setInventory).catch(e => { if (!controller.signal.aborted) setError(e.message); });
        return () => controller.abort();
    }, []);
    useEffect(() => {
        let disposed = false;
        let loading = false;
        const controller = new AbortController();
        setReport(null); setSelected(null); setCoverage(null);
        if (!run) return () => controller.abort();
        const load = async () => {
            if (loading) return;
            loading = true;
            try {
                const data = await api(`/testing/runs/${run}`, { signal: controller.signal });
                if (!disposed) { setReport(data); setError(''); }
            } catch (e) { if (!disposed) setError(e.message); }
            finally { loading = false; }
        };
        load(); const timer = setInterval(load, 2000);
        return () => { disposed = true; controller.abort(); clearInterval(timer); };
    }, [run]);
    const coverageSuite = suite === 'all' ? 'python' : suite;
    useEffect(() => {
        let disposed = false;
        const controller = new AbortController();
        setCoverage(null);
        if (view !== 'coverage' || !run) return () => controller.abort();
        const load = async () => {
            try {
                const data = await api(`/testing/runs/${run}/coverage/${coverageSuite}`, { signal: controller.signal });
                if (!disposed) setCoverage(data);
            } catch (e) { if (!disposed) setError(e.message); }
        };
        load(); const timer = setInterval(load, 5000);
        return () => { disposed = true; controller.abort(); clearInterval(timer); };
    }, [view, run, coverageSuite]);
    const start = async (suites) => {
        setStarting(true); setError('');
        try { const data = await postJson('/testing/runs', { suites }); await jobs.started(data.run_id); }
        catch (e) { setError(e.message); }
        finally { setStarting(false); }
    };
    const files = report?.files || inventory?.files || [];
    const rows = files.filter(f => (suite === 'all' || f.suite === suite) && (status === 'all' || f.status === status) && f.path.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => (STATUS_ORDER.indexOf(a.status) < 0 ? STATUS_ORDER.length : STATUS_ORDER.indexOf(a.status))
            - (STATUS_ORDER.indexOf(b.status) < 0 ? STATUS_ORDER.length : STATUS_ORDER.indexOf(b.status)));
    const chosen = files.find(f => f.id === selected);
    const runningSuite = jobs.selectedRun?.status === 'running' ? jobs.selectedRun.steps?.find(step => step.status === 'running' && ['python', 'frontend', 'chat'].includes(step.name))?.name : null;
    const runningSetup = files.find(f => f.suite === runningSuite && f.path === '__setup__');
    const showSetup = setup => { setSuite(setup.suite); setStatus('all'); setView('tests'); setQuery(''); setSelected(setup.id); };
    const disabled = jobs.busy || starting || !inventory;
    return <PageShell title="🧪 Tests & Coverage" subtitle="Local source · Python, frontend and Chat · test files and source coverage">
        <ErrorBanner message={error || jobs.error || jobs.pollError} onClose={() => { setError(''); jobs.setError(''); }} />
        <BusyNotice jobs={jobs} />
        <Card title="Run tests" right={jobs.selectedRun && <StatusBadge status={jobs.selectedRun.status} />}>
            <div className="flex flex-wrap gap-2">
                <button disabled={disabled} onClick={() => start(['python', 'frontend', 'chat'])} className="rounded bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-40">Run all tests</button>
                {inventory?.suites.map(s => <button key={s.id} disabled={disabled || !s.available} onClick={() => start([s.id])} className="rounded border px-3 py-2 text-sm disabled:opacity-40">Run {s.id} ({s.count} files)</button>)}
                {jobs.activeHere && <button onClick={jobs.cancel} className="border rounded px-3 text-red-700 text-sm">Cancel run</button>}
            </div>
            <p className="text-xs text-slate-500 mt-3">Includes slow and integration tests. Python tests may call paid model APIs configured in tests/.env. Test OpenSearch stays running for reuse.</p>
            <details className="text-xs mt-2"><summary className="cursor-pointer">Requirements & isolation</summary><ul className="list-disc pl-5">{inventory?.requirements.map(r => <li key={r}>{r}</li>)}</ul></details>
            {jobs.selectedRun && <p className="text-xs text-slate-500 mt-2">Run {run} · {jobs.selectedRun.label} · Reports retained for the latest 10 runs. Logs keep a bounded tail per file.</p>}
        </Card>
        {runningSetup && <div role="status" className="bg-blue-50 border border-blue-200 text-blue-800 rounded p-3 text-sm">
            <strong className="capitalize">{runningSuite}</strong>: {runningSetup.phase || 'Preparing or running tests and shared fixtures'}.
            <button className="ml-2 underline" onClick={() => showSetup(runningSetup)}>View live setup logs</button>
            <p className="text-xs mt-1">Other suites wait until this suite finishes. Queued files have not started yet.</p>
        </div>}
        <div className="grid sm:grid-cols-3 gap-3">{inventory?.suites.map(s => <SuiteSummary key={s.id} suite={s} files={files} activeSuite={suite} activeStatus={status} runningSuite={runningSuite} runStatus={jobs.selectedRun?.status}
            onFilter={(suiteId, state) => { setSuite(suiteId); setStatus(state); setView('tests'); setQuery(''); }}
            onSetup={showSetup} />)}</div>
        <div className="flex flex-wrap gap-3 items-center text-sm">
            <button onClick={() => setView('tests')} className={view === 'tests' ? 'text-blue-600 font-semibold' : ''}>Test files</button>
            <button onClick={() => setView('coverage')} className={view === 'coverage' ? 'text-blue-600 font-semibold' : ''}>Source coverage</button>
            <select aria-label="Suite" value={suite} onChange={e => setSuite(e.target.value)} className="border rounded p-1"><option value="all">All suites</option>{['python', 'frontend', 'chat'].map(s => <option key={s}>{s}</option>)}</select>
        </div>
        {view === 'tests' ? <>
            <div className="flex gap-2"><input value={query} onChange={e => setQuery(e.target.value)} aria-label="Find test file" placeholder="Find test file…" className="border rounded p-2 flex-1 text-sm" /><label className="flex items-center gap-2 text-sm text-slate-600">Status<select aria-label="File status" value={status} onChange={e => setStatus(e.target.value)} className="border rounded text-sm"><option value="all">All statuses</option>{STATUS_ORDER.map(s => <option key={s} value={s}>{FILE_STATUSES[s]}</option>)}</select></label></div>
            <div className="max-h-96 overflow-auto border rounded bg-white"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Test file</th><th>Status</th><th>Pass / Fail / Skip</th><th>Duration</th></tr></thead><tbody>{rows.map(f => <tr key={f.id} className={f.id === selected ? 'bg-blue-50' : ''}><td className="p-2"><button disabled={!report} onClick={() => setSelected(f.id)} className="text-left text-blue-600 break-all"><span className="text-slate-500 text-xs mr-2">{f.suite}</span>{f.path === '__setup__' ? 'Suite setup / runner output' : f.path}</button></td><td><TestStatus status={f.status} /></td><td>{f.counts.passed || 0} / {f.counts.failed || 0} / {f.counts.skipped || 0}</td><td>{f.duration.toFixed(2)}s</td></tr>)}</tbody></table>{!rows.length && <p className="p-3 text-sm">No matching files.</p>}</div>
            {chosen && report && <TestFileDetails run={run} file={chosen} />}
        </> : <CoverageView key={`${run}-${coverageSuite}`} suite={coverageSuite} data={coverage} />}
        <JobHistory jobs={jobs} />
    </PageShell>;
}
