import React, { useEffect, useState } from 'react';
import { api, Card, useJobs, RunPanel, JobHistory, BusyNotice } from '../dev/JobUI';
import { useDevShell } from '../dev/DevShell';
import { httpsSummary, RenewalConfirmation } from '../dev/HttpsStatus';
import ProductionLogs from './ProductionLogs';

function date(value) {
    if (!value) return 'Unknown';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(undefined, { timeZoneName: 'short' });
}

function Problem({ children }) {
    return <p role="alert" className="text-sm text-red-700 break-words">{children}</p>;
}

export default function ProductionTab({ section = 'all' }) {
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [confirm, setConfirm] = useState(false);
    const https = useDevShell().https;
    const jobs = useJobs('certificates', () => {
        setRefresh(value => value + 1);
        https?.refresh(true);
    });
    useEffect(() => { if (https?.runId) jobs.started(https.runId); }, [https?.runId]); // follow a renewal started in the top bar
    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        api(`/deploy/production${refresh ? '?fresh=true' : ''}`).then(data => {
            if (active) setReport(data);
        }).catch(err => {
            if (active) setError(err.message);
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [refresh]);

    const renewal = report?.renewal;
    const timer = renewal?.timer;
    const service = renewal?.service;
    const renewalFailed = service?.Result && service.Result !== 'success';
    const certificates = Array.isArray(report?.certificates) ? report.certificates : [];
    return <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 className="font-semibold text-slate-800">{section === 'certificates' ? '🔐 HTTPS certificates' : 'Production health'}</h2>
                <p className="text-xs text-slate-500">Read-only checks{report?.host ? ` · ${report.host}` : ''}. Refresh to fetch current status.</p>
                {report && <p className="text-xs text-slate-500">Last checked: {date(report.checked_at)}{loading || error ? ' · Previous results' : ''}</p>}
            </div>
            <div className="flex gap-2">
            <button onClick={() => setConfirm(true)} disabled={!https || https.starting || jobs.busy}
                className="cursor-pointer px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50">Renew credentials</button>
            <button onClick={() => { setRefresh(n => n + 1); https?.refresh(true); }} disabled={loading}
                className="cursor-pointer px-3 py-1.5 rounded border border-slate-300 text-sm disabled:opacity-50">
                {loading ? 'Checking production…' : 'Refresh production'}
            </button>
            </div>
        </div>
        {https?.starting && <p role="status">Starting certificate renewal…</p>}
        {https?.renewError && <Problem>{https.renewError}</Problem>}
        <BusyNotice jobs={jobs} />
        <RunPanel jobs={jobs} />
        <JobHistory jobs={jobs} />
        {confirm && <RenewalConfirmation onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); https.renew(); }} />}
        {loading && <p role="status" className="text-sm text-slate-500">Checking certificates, renewal and system status…</p>}
        {error && <Problem>Could not refresh production: {error}</Problem>}
        {report?.reachable === false && <Problem>Production checks unavailable: {report.error}</Problem>}
        {section === 'all' && <ProductionLogs />}
        {report?.reachable && <>
            {renewalFailed && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800 text-sm">
                Automatic certificate renewal failed. HTTPS may still work until the current certificate expires.
            </div>}
            {section === 'all' && <div className="grid md:grid-cols-2 gap-4">
                <Card title="Ubuntu">
                    {report.system.error ? <Problem>{report.system.error}</Problem> : <div className="text-sm space-y-2">
                        <p>{report.system.ubuntu}</p>
                        <p>{report.system.reboot_required ? 'Reboot required' : 'No reboot currently requested'}</p>
                    </div>}
                </Card>
                <Card title="Pending updates">
                    {report.updates.error ? <Problem>{report.updates.error}</Problem> : <div className="text-sm space-y-2">
                        <p>{report.updates.pending} packages · {report.updates.security} from security repositories</p>
                        <p className="text-xs text-slate-500">{report.updates.source}</p>
                    </div>}
                </Card>
            </div>}
            <Card title="HTTPS certificates on disk">
                {report.certificates.error && <Problem>{report.certificates.error}</Problem>}
                <div className="space-y-4">{certificates.map(cert => <div key={cert.name} className="text-sm space-y-1">
                    <p className="font-medium">{cert.name}</p>
                    {cert.error ? <Problem>{cert.error}</Problem> : <>
                        <p className="break-words">{cert.domains.join(', ')}</p>
                        <p className={httpsSummary({ reachable: true, endpoints: [{ expires_at: cert.expires_at }] }).state === 'red' ? 'text-red-700 font-medium' : httpsSummary({ reachable: true, endpoints: [{ expires_at: cert.expires_at }] }).state === 'orange' ? 'text-orange-700' : 'text-green-700'}>
                            {cert.expired ? 'Expired' : `${cert.days_remaining} full days remaining`} · Expires {date(cert.expires_at)}
                        </p>
                        <p className="text-xs text-slate-500">Issued {date(cert.issued_at)} · {cert.issuer}</p>
                    </>}
                </div>)}</div>
            </Card>
            <Card title="Live HTTPS endpoints">
                <p className="text-xs text-slate-500 mb-3">Checks each domain’s certificate, hostname and trust chain from the production VM.</p>
                <div className="space-y-4">{report.endpoints.map(endpoint => <div key={endpoint.domain} className="text-sm space-y-1">
                    <p className="font-medium">{endpoint.domain}</p>
                    {endpoint.error ? <Problem>{endpoint.error}</Problem> : <>
                        <p className={endpoint.valid ? 'text-green-700' : 'text-red-700'}>{endpoint.valid ? 'Certificate valid' : 'Certificate validation failed'}</p>
                        {endpoint.validation_error && <Problem>{endpoint.validation_error}</Problem>}
                        <p>Expires {date(endpoint.expires_at)} · {endpoint.days_remaining} full days remaining</p>
                        {endpoint.matches_disk === false ? <Problem>Served certificate differs from disk. Nginx may need a reload.</Problem>
                            : <p className="text-xs text-slate-500">{endpoint.matches_disk ? 'Matches certificate on disk' : 'Disk comparison unavailable'}</p>}
                    </>}
                </div>)}</div>
            </Card>
            <Card title="Automatic renewal">
                {renewal.error ? <Problem>{renewal.error}</Problem> : <div className="text-sm space-y-2">
                    <p>Timer: {timer?.ActiveState || 'Unknown'} · {timer?.UnitFileState || 'Unknown'}</p>
                    {timer?.ActiveState !== 'active' && <Problem>Certificate renewal timer is not active.</Problem>}
                    <p>Next attempt: {date(timer?.NextElapseUSecRealtime)}</p>
                    <p>Last attempt: {date(service?.ExecMainExitTimestamp)} · Result: {service?.Result || 'Unknown'}</p>
                    {renewal.methods.map(method => <p key={method.name}>{method.name}: {method.authenticator}</p>)}
                    {renewal.log_error && <Problem>Renewal logs unavailable: {renewal.log_error}</Problem>}
                    {renewal.recent_log && <details>
                        <summary className="cursor-pointer text-slate-600">Recent renewal logs</summary>
                        <pre className="mt-2 p-3 bg-slate-50 rounded text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto">{renewal.recent_log}</pre>
                    </details>}
                </div>}
            </Card>
        </>}
    </div>;
}
