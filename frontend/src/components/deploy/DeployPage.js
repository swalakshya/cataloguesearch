import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    api, postJson, timeAgo, Card, PageShell, ErrorBanner, ConfirmModal,
    useJobs, BusyNotice, RunPanel, JobHistory,
} from '../dev/JobUI';
import CleanupTab from './CleanupTab';
import OpenSearchCompare, { useOpenSearchCompare } from './OpenSearchCompare';

// Run steps, in order. The run keeps copy and restore as separate steps so "Retry from here" works.
const ACTION_ORDER = ['build', 'copy_snapshots', 'restore_prod'];
// What the page offers: two cards, the second one runs both OpenSearch steps together.
const CARDS = [
    {
        id: 'build',
        title: 'Build & push images',
        short: 'Build & push',
        actions: ['build'],
        hint: 'docker compose build --push (main repo with .env.local; chat from its own repo)',
    },
    {
        id: 'opensearch',
        title: 'Deploy OpenSearch to prod',
        short: 'OpenSearch snapshot → prod',
        actions: ['copy_snapshots', 'restore_prod'],
        hint: 'Snapshot local OpenSearch, compress and stream to prod and verify checksums, then on prod: pull images, restore indices from the snapshots, recreate services',
    },
];
// Actions that change prod and therefore need a typed confirmation.
const DANGEROUS = new Set(['restore_prod']);

export default function DeployPage() {
    const [params, setParams] = useSearchParams();
    const tab = params.get('tab') === 'cleanup' ? 'cleanup' : 'deploy';
    const setTab = (t) => setParams(t === 'deploy' ? {} : { tab: t }, { replace: true });
    const [config, setConfig] = useState(null);
    const [overview, setOverview] = useState(null);
    const [prod, setProd] = useState(null);
    const [prodLoading, setProdLoading] = useState(false);
    const [buildServices, setBuildServices] = useState([]);
    const [confirm, setConfirm] = useState(null);
    const compare = useOpenSearchCompare();
    const jobsRef = useRef(null); // lets callbacks defined before useJobs() report errors

    const loadOverview = useCallback(async () => {
        try { setOverview(await api('/deploy/overview')); } catch (e) { jobsRef.current.setError(e.message); }
    }, []);

    const loadProd = useCallback(async () => {
        setProdLoading(true);
        try { setProd(await api('/deploy/prod')); } catch (e) { setProd({ reachable: false, error: e.message, containers: [] }); }
        setProdLoading(false);
    }, []);

    // Refresh registry / OpenSearch / prod status when a run ends.
    const jobs = useJobs('deploy', () => { loadOverview(); loadProd(); compare.refresh(); });
    jobsRef.current = jobs;

    useEffect(() => {
        api('/deploy/config').then((c) => {
            setConfig(c);
            setBuildServices(c.default_build_services);
        }).catch((e) => jobsRef.current.setError(`Cannot reach the dev server: ${e.message}`));
        loadOverview();
    }, [loadOverview]);

    const start = useCallback(async (actions, services) => {
        jobsRef.current.setError('');
        try {
            const { run_id: runId } = await postJson('/deploy/runs', {
                actions, build_services: actions.includes('build') ? services : null,
            });
            await jobsRef.current.started(runId);
        } catch (e) { jobsRef.current.setError(e.message); }
    }, []);

    const requestRun = (actions, services = buildServices) => {
        const titles = Object.fromEntries((config?.actions || []).map((a) => [a.id, a.title]));
        const pushesOpenSearch = actions.some((a) => a === 'copy_snapshots' || a === 'restore_prod');
        const alreadySynced = pushesOpenSearch && compare.report?.in_sync;
        if (!alreadySynced && !actions.some((a) => DANGEROUS.has(a))) { start(actions, services); return; }
        setConfirm({
            title: actions.includes('build') && actions.length > 1 ? 'Run full deploy to prod?'
                : actions.includes('copy_snapshots') ? 'Deploy OpenSearch to prod?' : 'Restore on prod?',
            lines: [
                ...(alreadySynced ? ['Prod already matches dev, so this would push nothing new.'] : []),
                ...actions.map((a) => titles[a] || a),
                `Host: ${config?.prod_host}`,
                'Restore deletes the prod indices and replaces them with the snapshots. Prod restarts briefly.',
            ],
            actions,
            services,
        });
    };

    const retryFrom = (run, stepName) => {
        const idx = run.steps.findIndex((s) => s.name === stepName);
        const actions = run.steps.slice(idx).map((s) => s.name);
        const services = run.params?.build_services || buildServices;
        setBuildServices(services);
        requestRun(actions, services);
    };

    const busy = jobs.busy;
    const toggleService = (s) => setBuildServices((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

    return (
        <PageShell title="Deploy" subtitle={`Local dev server → registry → ${config?.prod_host || 'prod'}`}>
            <div className="flex border-b border-slate-200" role="tablist" aria-label="Deploy sections">
                {[['deploy', 'Deploy'], ['cleanup', 'Clean up']].map(([id, label]) => (
                    <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                        className={`cursor-pointer px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${tab === id ? 'border-sky-600 text-sky-700 font-medium' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'cleanup' && <CleanupTab prodHost={config?.prod_host} />}

            {/* Stays mounted (just hidden) so its polling and your selections survive a visit to the other tab. */}
            <div className={tab === 'deploy' ? 'space-y-4' : 'hidden'}>
            <div className="bg-white border-2 border-blue-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                    <h2 className="text-base font-semibold text-slate-800">Full deploy</h2>
                    <p className="text-sm text-slate-500 mt-1">Runs both jobs below, one after another. Stops at the first failure.</p>
                    <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-slate-600">
                        {CARDS.map((card, idx) => (
                            <React.Fragment key={card.id}>
                                {idx > 0 && <span className="text-slate-300">→</span>}
                                <span className="px-2 py-1 rounded-full bg-slate-100 border border-slate-200">
                                    {idx + 1}. {card.short}
                                </span>
                            </React.Fragment>
                        ))}
                    </div>
                </div>
                <button
                    disabled={busy || !config}
                    onClick={() => requestRun(ACTION_ORDER)}
                    className="cursor-pointer px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold shadow-md hover:shadow-lg transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none whitespace-nowrap"
                >
                    {busy ? 'A run is in progress…' : 'Deploy to prod  ▶'}
                </button>
            </div>

            <ErrorBanner message={jobs.error} onClose={() => jobs.setError('')} />
            <BusyNotice jobs={jobs} />

            <div className="grid md:grid-cols-3 gap-4">
                <Card title="Local OpenSearch" right={<button onClick={loadOverview} className="cursor-pointer text-xs text-blue-600 hover:underline">refresh</button>}>
                    {!overview ? <p className="text-sm text-slate-400">Loading…</p> : !overview.opensearch.reachable ? (
                        <p className="text-sm text-red-600">Not reachable</p>
                    ) : (
                        <div className="text-sm space-y-1">
                            <div>Cluster: <span className="font-medium">{overview.opensearch.status}</span></div>
                            {overview.opensearch.indices.map((i) => (
                                <div key={i.name} className="flex justify-between text-xs text-slate-600">
                                    <span className="truncate mr-2">{i.name.replace('cataloguesearch_prod', 'prod')}</span>
                                    <span>{i.docs.toLocaleString()} docs · {i.size}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
                <Card title="Registry images" right={overview?.registry?.repo && <span className="text-xs text-slate-400">{overview.registry.repo}</span>}>
                    {!overview ? <p className="text-sm text-slate-400">Loading…</p> : !overview.registry.reachable ? (
                        <p className="text-sm text-slate-500">Docker Hub not reachable</p>
                    ) : (
                        <div className="text-xs text-slate-600 space-y-1">
                            {overview.registry.tags.map((t) => (
                                <div key={t.name} className="flex justify-between">
                                    <span className="font-mono">{t.name}</span><span>{timeAgo(t.last_pushed)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
                <Card title="Prod" right={<button onClick={loadProd} disabled={prodLoading} className="cursor-pointer text-xs text-blue-600 hover:underline disabled:opacity-50">{prodLoading ? 'checking…' : 'check'}</button>}>
                    {!prod ? <p className="text-sm text-slate-400">Not checked yet</p> : !prod.reachable ? (
                        <p className="text-sm text-red-600 break-words">Unreachable: {prod.error}</p>
                    ) : (
                        <div className="text-xs text-slate-600 space-y-1">
                            {prod.containers.map((c) => (
                                <div key={c.name}>
                                    <span className="font-medium">{c.name}</span>
                                    <div className="text-slate-400 truncate">{c.image} · {c.status}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {overview && overview.tooling && (!overview.tooling.zstandard || !overview.tooling.pv || !overview.tooling.docker || !overview.tooling.build_env_file) && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded p-3">
                    Missing on this machine:{' '}
                    {[!overview.tooling.docker && 'docker', !overview.tooling.pv && 'pv',
                      !overview.tooling.zstandard && `zstandard (for ${overview.tooling.python})`,
                      !overview.tooling.build_env_file && config?.build_env_file].filter(Boolean).join(', ')}
                </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
                {CARDS.map((card, idx) => (
                    <Card key={card.id} title={`${idx + 1}. ${card.title}`}>
                        <p className="text-xs text-slate-500 mb-3">{card.hint}</p>
                        {card.id === 'opensearch' && <OpenSearchCompare compare={compare} />}
                        {card.id === 'build' && config && (
                            <div className="mb-3 space-y-1">
                                {config.build_services.map((s) => (
                                    <label key={s} className="flex items-center gap-2 text-sm text-slate-700">
                                        <input type="checkbox" checked={buildServices.includes(s)} onChange={() => toggleService(s)} />
                                        {s}
                                    </label>
                                ))}
                            </div>
                        )}
                        <button
                            disabled={busy || !config || (card.id === 'build' && buildServices.length === 0)}
                            onClick={() => requestRun(card.actions)}
                            className={`cursor-pointer px-3 py-1.5 rounded text-sm font-medium border shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${card.actions.some((a) => DANGEROUS.has(a)) ? 'border-red-300 text-red-700 hover:bg-red-50' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                        >
                            Run
                        </button>
                    </Card>
                ))}
            </div>

            <RunPanel jobs={jobs} onRetry={retryFrom} />
            <JobHistory jobs={jobs} />

            {confirm && (
                <ConfirmModal
                    title={confirm.title}
                    lines={confirm.lines}
                    phrase="prod"
                    onCancel={() => setConfirm(null)}
                    onConfirm={() => { const { actions, services } = confirm; setConfirm(null); start(actions, services); }}
                />
            )}
            </div>
        </PageShell>
    );
}
