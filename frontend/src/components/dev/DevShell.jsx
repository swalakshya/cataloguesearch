import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { api } from './JobUI';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import HttpsPill, { useHttpsStatus } from './HttpsStatus';
import DashboardUpdate from './DashboardUpdate';
import { AREAS, areaFor, toolFor } from './navigation';

// Shared Dev/Prod layout with environment navigation, tool sections and global health/job indicators.
// Eval fills the remaining window and can hide navigation in focus mode.

const FOCUS_KEY = 'eval_focus';


const DevShellContext = createContext({ focus: false, setFocus: () => {}, inShell: false, docker: null });
export const useDevShell = () => useContext(DevShellContext);

// Esc belongs to an open dialog, popover or menu (file browser, Verify sub-sections, paths popover, ...).
export const dialogIsOpen = () => !!document.querySelector('[role="dialog"], [aria-modal="true"], [data-esc-owner]');

const readFocus = () => {
    try { return localStorage.getItem(FOCUS_KEY) === '1'; } catch { return false; }
};

const minutes = (iso) => {
    const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

// ---- Docker light -------------------------------------------------------------------------------------------------
// Docker (OrbStack) sometimes gets stuck: `docker ps` takes ten seconds or never answers, and only a restart helps.
// The server probes it; yellow (slow) and red (no answer) block every job that needs Docker until it is restarted.

const DOCKER_POLL_MS = { ok: 15000, bad: 6000, restarting: 2500 };

export function dockerState(info, offline) {
    if (offline) return 'unknown';
    if (!info) return 'checking';
    if (info.restarting) return 'restarting';
    return ['ok', 'slow', 'down'].includes(info.status) ? info.status : 'checking';
}

export function useDockerStatus() {
    const [info, setInfo] = useState(null);
    const [offline, setOffline] = useState(false);
    const [restartNote, setRestartNote] = useState('');
    const [restartError, setRestartError] = useState('');
    const stateRef = useRef('checking');

    const refresh = useCallback(async (fresh = false) => {
        try {
            const data = await api(`/deploy/docker${fresh ? '?fresh=true' : ''}`);
            stateRef.current = dockerState(data, false);
            setInfo(data);
            setOffline(false);
            if (data.restarting && data.active_run_id) {
                try {
                    const run = await api(`/jobs/runs/${data.active_run_id}`);
                    const step = run.steps.find((st) => st.status === 'running') || run.steps[run.steps.length - 1];
                    setRestartNote((step && step.progress && step.progress.phase && step.progress.phase.label) || '');
                } catch { /* the note is a nicety */ }
            } else {
                setRestartNote('');
            }
        } catch {
            stateRef.current = 'unknown';
            setOffline(true);
        }
    }, []);

    useEffect(() => {
        let alive = true;
        let timer;
        const tick = async () => {
            await refresh();
            if (!alive) return;
            const st = stateRef.current;
            timer = setTimeout(tick, st === 'restarting' ? DOCKER_POLL_MS.restarting : st === 'ok' ? DOCKER_POLL_MS.ok : DOCKER_POLL_MS.bad);
        };
        tick();
        return () => { alive = false; clearTimeout(timer); };
    }, [refresh]);

    const restart = useCallback(async () => {
        setRestartError('');
        try {
            await api('/deploy/docker/restart', { method: 'POST' });
            await refresh(true);
        } catch (e) {
            setRestartError(e.message);
        }
    }, [refresh]);

    const state = dockerState(info, offline);
    return {
        state, info, restartNote, restartError, refresh, restart,
        // yellow, red and "restarting" all mean: don't start anything that needs Docker
        blocked: state === 'slow' || state === 'down' || state === 'restarting',
    };
}

const LIGHT = {
    ok: { dot: 'bg-emerald-400', label: () => 'Docker' },
    slow: { dot: 'bg-amber-400', label: (i) => `Docker slow${i && i.seconds ? ` · ${i.seconds}s` : ''}` },
    down: { dot: 'bg-red-500 animate-pulse', label: () => 'Docker not responding' },
    restarting: { dot: 'bg-blue-400 animate-pulse', label: () => 'Restarting Docker…' },
    checking: { dot: 'bg-slate-500', label: () => 'Docker…' },
    unknown: { dot: 'bg-slate-500', label: () => 'Docker ?' },
};

function DockerLight({ docker }) {
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const ref = useRef(null);
    useOutsideClick(ref, () => { setOpen(false); setConfirming(false); }, { enabled: open });
    const { state, info } = docker;
    const light = LIGHT[state];
    const otherJob = !!(info && info.active_run_id && !info.restarting);
    const bad = state === 'slow' || state === 'down';
    return (
        <div ref={ref} className="relative">
            <button onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} data-testid="docker-light" data-state={state}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-slate-100">
                <span className={`inline-block w-2 h-2 rounded-full ${light.dot}`} aria-hidden="true" />
                <span aria-hidden="true">🐳</span>{light.label(info)}
            </button>
            {open && (
                <div role="dialog" aria-label="Docker" data-esc-owner
                    className="absolute right-0 top-full mt-1.5 z-50 w-80 rounded-md border border-slate-200 bg-white text-slate-700 shadow-lg p-3 space-y-2 text-sm">
                    <div className="font-semibold text-slate-800">Docker (OrbStack)</div>
                    <p data-testid="docker-message">
                        {state === 'restarting' ? `Restarting…${docker.restartNote ? ` ${docker.restartNote}` : ''}`
                            : state === 'unknown' ? 'The dev server is not reachable.'
                                : (info && info.message) || 'Checking…'}
                    </p>
                    {bad && <p className="text-xs text-amber-700">Builds, snapshots, indexing and local cleanup are switched off until Docker is healthy again.</p>}
                    {docker.restartError && <p className="text-xs text-red-700" role="alert">{docker.restartError}</p>}
                    {otherJob && <p className="text-xs text-slate-500">A job is running, so Docker cannot be restarted now. Cancel that job first.</p>}
                    {confirming ? (
                        <div className="rounded border border-red-200 bg-red-50 p-2 space-y-2">
                            <p className="text-xs text-red-800">Restart OrbStack? Every local container, including the dev OpenSearch, stops for about a minute.</p>
                            <div className="flex gap-2">
                                <button onClick={() => { setConfirming(false); docker.restart(); }}
                                    className="cursor-pointer text-xs px-2.5 py-1 rounded bg-red-600 text-white hover:bg-red-700">Yes, restart</button>
                                <button onClick={() => setConfirming(false)} className="cursor-pointer text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <button onClick={() => setConfirming(true)} disabled={otherJob || state === 'restarting'}
                                className={`cursor-pointer text-xs px-2.5 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed ${bad ? 'border-red-600 bg-red-600 text-white hover:bg-red-700' : 'border-slate-300 hover:bg-slate-50'}`}>
                                Restart Docker (OrbStack)
                            </button>
                            <button onClick={() => docker.refresh(true)} className="cursor-pointer text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50">Check now</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// The reason a Docker-dependent button is off, shown at the top of pages that have such buttons.
export function DockerBlockedNotice() {
    const { docker } = useDevShell();
    if (!docker || !docker.blocked) return null;
    return (
        <div role="status" data-testid="docker-blocked" className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded p-3">
            {docker.state === 'restarting' ? 'Docker is restarting.' : docker.state === 'down' ? 'Docker is not responding.' : 'Docker is slow.'}
            {' '}Jobs that need it are switched off. Open the Docker light at the top to restart it.
        </div>
    );
}

// Only one job (discover or deploy) runs at a time, so a single indicator in the bar covers every page.
export function JobPill() {
    const [state, setState] = useState({ run: null, offline: false });

    useEffect(() => {
        let alive = true;
        let timer;
        const tick = async () => {
            let running = false;
            try {
                const data = await api('/jobs/runs?limit=1');
                const run = data.runs.find((r) => r.id === data.active_run_id) || (data.active_run_id ? { id: data.active_run_id, kind: null } : null);
                running = !!run;
                if (alive) setState({ run, offline: false });
            } catch {
                if (alive) setState((s) => ({ ...s, offline: true }));
            }
            if (alive) timer = setTimeout(tick, running ? 5000 : 15000);
        };
        tick();
        return () => { alive = false; clearTimeout(timer); };
    }, []);

    if (state.offline) {
        return <span className="text-xs text-red-300" title="Start it with: uvicorn dev:app --host 127.0.0.1 --port 8001">● dev server offline</span>;
    }
    if (!state.run) return null;
    const { kind, created_at: createdAt } = state.run;
    const name = kind === 'gc' ? 'Cleanup' : kind === 'docker' ? 'Docker restart' : kind ? kind[0].toUpperCase() + kind.slice(1) : 'A job';
    const actions = state.run.params?.actions || state.run.steps?.map(step => step.name) || [];
    const to = kind === 'services' || kind === 'docker' ? '/dev/services' : kind === 'certificates' ? '/prod/certificates'
        : kind === 'gc' ? (state.run.params?.target === 'prod' ? '/prod/cleanup' : '/dev/cleanup')
        : kind === 'backup' ? '/dev/backups' : kind === 'deploy' ? (actions.includes('restore_prod') ? '/prod/backups' : actions.includes('build') ? '/dev/deploy' : '/prod/services')
        : kind === 'testing' ? '/dev/tests' : kind === 'discover' ? '/dev/discover' : '/dev';
    return (
        <Link to={to}
            className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-100 hover:bg-blue-500/30" data-testid="job-pill">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            {name} running{createdAt ? ` · ${minutes(createdAt)}` : ''}
        </Link>
    );
}

function DevNav({ docker, https }) {
    const { pathname } = useLocation();
    const area = areaFor(pathname);
    const tool = toolFor(pathname);
    return <header className="shrink-0 bg-slate-900 text-slate-200" data-testid="dev-nav">
        <div className="min-h-12 flex flex-wrap items-center gap-2 px-3 py-1">
            {import.meta.env.REACT_APP_STANDALONE_DASHBOARD
                ? <a href="http://localhost:3000" className="text-sm text-slate-300 hover:text-white pr-2" title="Open the application when it is running">← Application</a>
                : <Link to="/" className="text-sm text-slate-300 hover:text-white pr-2">← Home</Link>}
            <nav aria-label="Environment" className="flex gap-1">
                {Object.entries(AREAS).map(([key, value]) => <Link key={key} to={value.home} aria-current={area === key ? 'page' : undefined}
                    className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${area === key ? key === 'prod' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-sky-500/20 text-sky-200' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                    <span aria-hidden="true" className="mr-2">{value.icon}</span>{value.label}
                </Link>)}
            </nav>
            <div className="ml-auto flex flex-wrap items-center gap-2"><DashboardUpdate /><DockerLight docker={docker} /><HttpsPill https={https} /><JobPill /></div>
        </div>
        <nav aria-label={`${AREAS[area].label} tools`} className="flex gap-1 px-3 border-t border-white/10 overflow-x-auto">
            {AREAS[area].sections.map(([to, label, icon]) => <Link key={to} to={to} aria-current={tool === to ? 'page' : undefined}
                className={`shrink-0 px-3 py-2 text-xs border-b-2 ${tool === to ? 'border-sky-400 text-white' : 'border-transparent text-slate-300 hover:text-white hover:bg-white/5'}`}>
                <span aria-hidden="true" className="mr-1.5">{icon}</span>{label}
            </Link>)}
        </nav>
    </header>;
}

export default function DevShell() {
    const { pathname } = useLocation();
    const isEval = toolFor(pathname).startsWith('/dev/eval');
    const [focusPref, setFocusPref] = useState(readFocus);
    const focus = isEval && focusPref;

    const setFocus = useCallback((on) => {
        setFocusPref(!!on);
        try { localStorage.setItem(FOCUS_KEY, on ? '1' : '0'); } catch { /* private mode: just don't remember */ }
    }, []);

    useEffect(() => {
        const area = AREAS[areaFor(pathname)];
        const section = area.sections.find(([to]) => to === toolFor(pathname));
        document.title = `Swalakshya · ${area.label}${section ? ` · ${section[1]}` : ''}`;
    }, [pathname]);

    // Esc brings the Dev bar back, unless a dialog / popover / menu is open and owns the key.
    useEffect(() => {
        if (!focus) return undefined;
        const onKey = (e) => { if (e.key === 'Escape' && !dialogIsOpen()) setFocus(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [focus, setFocus]);

    const docker = useDockerStatus();
    const https = useHttpsStatus();
    const value = useMemo(() => ({ focus, setFocus, inShell: true, docker, https }), [focus, setFocus, docker, https]);
    return (
        <DevShellContext.Provider value={value}>
            {/* The Eval tools take their card colours from these two variables, which the public site sets on its own root. */}
            <div className="h-screen flex flex-col text-ink font-sans"
                style={{ backgroundColor: 'var(--color-bg)', '--bg-card': 'var(--color-surface)', '--bg-surface': 'var(--color-bg)' }}>
                {!focus && <DevNav docker={docker} https={https} />}
                <main className={`flex-1 min-h-0 ${isEval ? 'overflow-hidden' : 'overflow-auto'}`} data-testid="dev-main">
                    <Outlet />
                </main>
            </div>
        </DevShellContext.Provider>
    );
}
