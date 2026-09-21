import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from './JobUI';

// One layout for every local dev page (/dev, /discover, /deploy, /eval): a slim dark bar with the dev sections and a
// live "job running" pill, instead of the public site's navigation. Eval fills the whole window below it.

const FOCUS_KEY = 'eval_focus';
const TITLES = { '/dev': 'Dev', '/discover': 'Discover', '/deploy': 'Deploy', '/eval': 'Eval' };
const SECTIONS = [
    { to: '/discover', label: 'Discover' },
    { to: '/deploy', label: 'Deploy' },
    { to: '/eval', label: 'Eval' },
];

const DevShellContext = createContext({ focus: false, setFocus: () => {}, inShell: false });
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
    const name = kind === 'gc' ? 'Cleanup' : kind ? kind[0].toUpperCase() + kind.slice(1) : 'A job';
    const to = kind === 'gc' ? '/deploy?tab=cleanup' : kind === 'deploy' ? '/deploy' : kind === 'discover' ? '/discover' : '/dev';
    return (
        <Link to={to}
            className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-100 hover:bg-blue-500/30" data-testid="job-pill">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            {name} running{createdAt ? ` · ${minutes(createdAt)}` : ''}
        </Link>
    );
}

function DevNav() {
    const link = ({ isActive }) => `px-3 h-full inline-flex items-center text-sm border-b-2 transition-colors ${
        isActive ? 'border-sky-400 text-white' : 'border-transparent text-slate-300 hover:text-white hover:bg-white/5'}`;
    return (
        <header className="h-11 shrink-0 flex items-center gap-1 px-3 bg-slate-900 text-slate-200" data-testid="dev-nav">
            <Link to="/" className="text-sm text-slate-300 hover:text-white pr-2" title="Back to the regular site">← Home</Link>
            <span className="h-5 w-px bg-slate-700 mr-1" aria-hidden="true" />
            <NavLink to="/dev" end className={link} title="Overview: pending files and running jobs">
                Dev <span className="ml-1.5 text-[10px] font-semibold tracking-wide px-1 rounded bg-amber-400 text-slate-900">LOCAL</span>
            </NavLink>
            {SECTIONS.map((s) => <NavLink key={s.to} to={s.to} className={link}>{s.label}</NavLink>)}
            <div className="ml-auto"><JobPill /></div>
        </header>
    );
}

export default function DevShell() {
    const { pathname } = useLocation();
    const isEval = pathname.startsWith('/eval');
    const [focusPref, setFocusPref] = useState(readFocus);
    const focus = isEval && focusPref;

    const setFocus = useCallback((on) => {
        setFocusPref(!!on);
        try { localStorage.setItem(FOCUS_KEY, on ? '1' : '0'); } catch { /* private mode: just don't remember */ }
    }, []);

    useEffect(() => {
        const key = Object.keys(TITLES).find((p) => pathname.startsWith(p));
        document.title = `Swalakshya · ${key ? TITLES[key] : 'Dev'}`;
    }, [pathname]);

    // Esc brings the Dev bar back, unless a dialog / popover / menu is open and owns the key.
    useEffect(() => {
        if (!focus) return undefined;
        const onKey = (e) => { if (e.key === 'Escape' && !dialogIsOpen()) setFocus(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [focus, setFocus]);

    const value = useMemo(() => ({ focus, setFocus, inShell: true }), [focus, setFocus]);
    return (
        <DevShellContext.Provider value={value}>
            {/* The Eval tools take their card colours from these two variables, which the public site sets on its own root. */}
            <div className="h-screen flex flex-col text-ink font-sans"
                style={{ backgroundColor: 'var(--color-bg)', '--bg-card': 'var(--color-surface)', '--bg-surface': 'var(--color-bg)' }}>
                {!focus && <DevNav />}
                <main className={`flex-1 min-h-0 ${isEval ? 'overflow-hidden' : 'overflow-auto'}`} data-testid="dev-main">
                    <Outlet />
                </main>
            </div>
        </DevShellContext.Provider>
    );
}
