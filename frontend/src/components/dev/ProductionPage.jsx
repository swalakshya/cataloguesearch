import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, postJson, Card, PageShell, ConfirmModal, useJobs, BusyNotice, RunPanel, JobHistory } from './JobUI';
import ProductionTab from '../deploy/ProductionTab';
import ProductionLogs from '../deploy/ProductionLogs';
import CleanupTab, { formatBytes } from '../deploy/CleanupTab';
import useServicePolling from './services/useServicePolling';

const NAMES = { 'cataloguesearch-api': ['⚙️', 'API'], 'cataloguesearch-frontend': ['🖥️', 'Application UI'], 'cataloguesearch-chat': ['💬', 'Chat'], 'opensearch-node': ['🔎', 'OpenSearch'], opensearch: ['🔎', 'OpenSearch'] };
const TITLES = { overview: '📊 Production overview', services: '⚙️ Production services', certificates: '🔐 HTTPS certificates', backups: '💾 Backups & restore', cleanup: '🧹 Production cleanup', host: '🛠️ Host maintenance' };
const percent = (used, total) => total ? `${(100 * used / total).toFixed(1)}%` : 'Unknown';
const date = value => value ? new Date(value).toLocaleString() : 'Unknown';

function ContainerList({ containers }) {
    if (!Array.isArray(containers)) return <p className="text-sm text-slate-500">{containers?.error || 'Container status unavailable.'}</p>;
    return <div className="grid md:grid-cols-2 gap-3">{containers.map(container => <Card key={container.name} title={<><span aria-hidden="true">{NAMES[container.name]?.[0] || '📦'} </span>{NAMES[container.name]?.[1] || container.name}</>}>
        <p className="text-sm">{container.status}</p>
        <p className="text-xs text-slate-500 break-all mt-2">{container.image}</p>
        <p className="text-xs font-mono text-slate-500 break-all">{container.image_id || container.id}</p>
        <p className="text-xs text-slate-500 mt-1">Created: {container.created_at || 'Unknown'}</p>
    </Card>)}</div>;
}

export default function ProductionPage({ section = 'overview' }) {
    const { data: report, error, loading, refresh } = useServicePolling('/deploy/production', { refreshPath: '/deploy/production?fresh=true', timeoutMs: 75000, enabled: !['certificates', 'cleanup'].includes(section) });
    const { data: deployments } = useServicePolling('/jobs/runs?kind=deploy&limit=1', { enabled: section === 'overview' });
    const [config, setConfig] = useState(null);
    const [selected, setSelected] = useState([]);
    const [confirm, setConfirm] = useState(null);
    const jobs = useJobs('deploy', refresh);
    useEffect(() => {
        if (!['services', 'backups'].includes(section)) return;
        let alive = true;
        api('/deploy/config').then(value => { if (alive) { setConfig(value); setSelected(value.default_build_services || []); } }).catch(err => { if (alive) jobs.setError(err.message); });
        return () => { alive = false; };
    }, [section]);
    const request = action => setConfirm(action);
    const run = async action => {
        setConfirm(null);
        jobs.setError('');
        try {
            const { run_id } = await postJson('/deploy/runs', { actions: [action], build_services: action === 'restore_prod' ? null : selected });
            await jobs.started(run_id);
        } catch (err) { jobs.setError(err.message); }
    };
    const resources = report?.resources;
    const snapshots = report?.snapshots;
    const restore = confirm === 'restore_prod';
    if (section === 'certificates') return <PageShell title={TITLES[section]} subtitle="🌍 Production · swalakshya"><ProductionTab section="certificates" /></PageShell>;
    if (section === 'cleanup') return <PageShell title={TITLES[section]} subtitle="🌍 Production · review space before removing anything"><CleanupTab key="prod" fixedTarget="prod" prodHost={report?.host} /></PageShell>;
    return <PageShell title={TITLES[section]} subtitle={`🌍 Production${report?.host ? ` · ${report.host}` : ''}`}>
        <div className="flex justify-between items-center gap-3">
            <p className="text-xs text-slate-500">{report ? `Last checked: ${date(report.checked_at)}` : 'Checking production…'}</p>
            <button onClick={refresh} disabled={loading} className="border rounded px-3 py-1.5 text-sm disabled:opacity-40">{loading ? 'Checking production…' : 'Refresh production'}</button>
        </div>
        {(error || report?.reachable === false) && <p role="alert" className="text-sm text-red-700">{error || report.error}</p>}
        {(section === 'overview' || section === 'host') && report?.reachable && <>
            <div className="grid md:grid-cols-3 gap-3">
                <Card title="🧠 CPU"><p>{resources?.cpu_percent == null ? 'Unknown' : `${resources.cpu_percent}%`}</p><p className="text-xs text-slate-500">{resources?.cpu_count || 'Unknown'} cores · short sample</p></Card>
                <Card title="📟 Memory"><p>{percent(resources?.memory_used, resources?.memory_total)}</p><p className="text-xs text-slate-500">{resources?.memory_total ? `${formatBytes(resources.memory_used)} / ${formatBytes(resources.memory_total)}` : 'Unavailable'}</p></Card>
                <Card title="💽 Disk"><p>{percent(resources?.disk_used, resources?.disk_total)}</p><p className="text-xs text-slate-500">{resources?.disk_total ? `${formatBytes(resources.disk_used)} / ${formatBytes(resources.disk_total)}` : 'Unavailable'}</p></Card>
            </div>
            {resources?.error && <p role="alert">Resource checks unavailable: {resources.error}</p>}
            <Card title="🛠️ Host status"><div className="grid md:grid-cols-2 gap-3 text-sm">
                <div><p>{report.system?.ubuntu || report.system?.error || 'Ubuntu version unavailable'}</p><p className="text-xs text-slate-500">Kernel: {report.system?.kernel || 'Unknown'} · Docker: {report.system?.docker || 'Unknown'}</p></div>
                <div><p>{report.system?.reboot_required == null ? 'Reboot status unavailable' : report.system.reboot_required ? 'Reboot required' : 'No reboot currently requested'}</p><p className="text-xs text-slate-500">Uptime: {resources?.uptime_seconds == null ? 'Unknown' : `${Math.floor(resources.uptime_seconds / 3600)} hours`}</p></div>
                <div><p>{report.updates?.error || `${report.updates?.pending ?? 'Unknown'} pending updates · ${report.updates?.security ?? 'Unknown'} security updates`}</p><p className="text-xs text-slate-500">{report.updates?.source}</p></div>
            </div></Card>
        </>}
        {section === 'overview' && <>
            <ContainerList containers={report?.containers} />
            <Card title="🚀 Last deployment job">{deployments?.runs?.[0] ? <p className="text-sm">{deployments.runs[0].label} · {deployments.runs[0].status} · {date(deployments.runs[0].finished_at || deployments.runs[0].created_at)}</p> : <p className="text-sm text-slate-500">No deployment history available.</p>}</Card>
            <div className="flex flex-wrap gap-4 text-sm text-blue-700"><Link to="/prod/certificates">🔐 Certificates & renewal</Link><Link to="/prod/backups">💾 Snapshots & restore</Link><Link to="/prod/services">⚙️ Service controls & logs</Link></div>
        </>}
        {section === 'services' && <>
            <ContainerList containers={report?.containers} />
            <Card title="Service controls"><p className="text-xs text-slate-500 mb-3">Restart uses the current images. Pull & restart fetches published images and recreates the selected services. Active requests may terminate.</p>
                <fieldset className="flex flex-wrap gap-4 mb-4"><legend className="text-xs text-slate-500 mb-2">Select services</legend>{config?.build_services.map(name => <label key={name} className="text-sm"><input type="checkbox" checked={selected.includes(name)} disabled={jobs.busy} onChange={() => setSelected(old => old.includes(name) ? old.filter(value => value !== name) : [...old, name])} /> {NAMES[name]?.[0]} {NAMES[name]?.[1] || name}</label>)}</fieldset>
                <div className="flex gap-3">{[['restart_services', 'Restart services'], ['pull_restart', 'Pull & restart']].map(([action, label]) => <button key={action} disabled={jobs.busy || !selected.length || !config} onClick={() => request(action)} className="border border-red-300 text-red-700 rounded px-3 py-1.5 text-sm disabled:opacity-40">{label}</button>)}</div>
            </Card>
            <ProductionLogs />
        </>}
        {section === 'backups' && <>
            <Card title="OpenSearch snapshots"><p className="text-xs text-slate-500 mb-3">Snapshots registered with production OpenSearch. Restore uses the staged snapshot files on the VM.</p>
                {snapshots?.error && <p role="alert" className="text-red-700 text-sm">{snapshots.error}</p>}
                {snapshots?.repositories?.length === 0 && <p className="text-sm">No snapshot repositories are registered.</p>}
                {snapshots?.repositories?.map(repository => <div key={repository.name} className="space-y-2 mb-4"><h3 className="font-semibold text-sm">{repository.name}</h3>{repository.error && <p role="alert">{repository.error}</p>}
                    {repository.snapshots?.map(snapshot => <div key={snapshot.snapshot} className="text-sm border-t pt-2"><p>{snapshot.snapshot} · {snapshot.state}</p><p className="text-xs text-slate-500">{date(snapshot.end_time || snapshot.start_time)} · {snapshot.indices?.length || 0} indices</p></div>)}
                </div>)}
                <button disabled={jobs.busy || !config || !report?.reachable} onClick={() => request('restore_prod')} className="mt-3 border border-red-300 text-red-700 rounded px-3 py-1.5 text-sm disabled:opacity-40">Restore staged snapshots…</button>
            </Card>
            <p className="text-xs text-slate-500">Application database and VM backups are not managed by this snapshot tool.</p>
            <Link to="/dev/backups" className="text-sm text-blue-700">💾 Laptop & Google Drive backups</Link>
        </>}
        {['services', 'backups'].includes(section) && <><BusyNotice jobs={jobs} />{jobs.error && <p role="alert" className="text-red-700 text-sm">{jobs.error}</p>}<RunPanel jobs={jobs} /><JobHistory jobs={jobs} /></>}
        {confirm && <ConfirmModal title={restore ? 'Restore production snapshots?' : confirm === 'restart_services' ? 'Restart production services?' : 'Pull & restart production services?'} phrase="prod"
            lines={[`Host: ${report?.host || config?.prod_host}`, ...(restore ? ['Production indices are deleted and replaced with staged snapshots. The restore also pulls images and restarts services.'] : [`Services: ${selected.join(', ')}`, 'Selected services restart and active requests may terminate.'])]}
            onCancel={() => setConfirm(null)} onConfirm={() => run(confirm)} />}
    </PageShell>;
}
