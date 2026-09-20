import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';

// Shared building blocks for the local dev pages (/deploy, /discover): job status, logs, history.

export const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

export async function api(path, options) {
    const resp = await fetch(`${API_BASE_URL}${path}`, options);
    let body = null;
    try { body = await resp.json(); } catch (_) { /* non-JSON error body */ }
    if (!resp.ok) throw new Error((body && body.detail) || `HTTP ${resp.status}`);
    return body;
}

export const postJson = (path, payload) => api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
});

const STATUS_STYLE = {
    pending: 'bg-slate-100 text-slate-500',
    running: 'bg-blue-100 text-blue-700',
    succeeded: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    cancelled: 'bg-amber-100 text-amber-700',
    waiting: 'bg-amber-100 text-amber-700',
    skipped: 'bg-slate-100 text-slate-400',
    interrupted: 'bg-amber-100 text-amber-700',
};

export function formatDuration(startIso, endIso, nowMs) {
    if (!startIso) return '';
    const start = new Date(startIso).getTime();
    const end = endIso ? new Date(endIso).getTime() : nowMs;
    const secs = Math.max(0, Math.round((end - start) / 1000));
    const m = Math.floor(secs / 60);
    return m > 0 ? `${m}m ${secs % 60}s` : `${secs}s`;
}

export function timeAgo(iso) {
    if (!iso) return '—';
    const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 90) return 'just now';
    if (secs < 5400) return `${Math.round(secs / 60)} min ago`;
    if (secs < 129600) return `${Math.round(secs / 3600)} h ago`;
    return `${Math.round(secs / 86400)} d ago`;
}

export function StatusBadge({ status, label }) {
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${STATUS_STYLE[status] || STATUS_STYLE.pending}`}>
            {status === 'running' && (
                <span className="inline-block w-2.5 h-2.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
            {label || status}
        </span>
    );
}

export function Card({ title, children, right }) {
    return (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
                {right}
            </div>
            {children}
        </div>
    );
}

export function PageShell({ title, subtitle, children }) {
    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
                <div>
                    <Link to="/dev" className="text-xs text-blue-600 hover:underline">← Dev home</Link>
                    <h1 className="text-xl font-semibold text-slate-800 mt-1">{title}</h1>
                    {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
                </div>
                {children}
            </div>
        </div>
    );
}

export function ErrorBanner({ message, onClose }) {
    if (!message) return null;
    return (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3 flex justify-between">
            <span>{message}</span>
            <button onClick={onClose} className="cursor-pointer text-red-400 hover:text-red-600">×</button>
        </div>
    );
}

export function ConfirmModal({ title, lines, phrase, onConfirm, onCancel, confirmLabel = 'Run' }) {
    const [typed, setTyped] = useState('');
    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5">
                <h3 className="text-base font-semibold text-slate-800 mb-2">{title}</h3>
                <ul className="text-sm text-slate-600 list-disc pl-5 space-y-1 mb-4">
                    {lines.map((l) => <li key={l}>{l}</li>)}
                </ul>
                <p className="text-sm text-slate-600 mb-2">Type <code className="font-mono font-semibold">{phrase}</code> to continue.</p>
                <input
                    autoFocus
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && typed === phrase) onConfirm(); }}
                    className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm mb-4"
                />
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="cursor-pointer px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
                    <button
                        disabled={typed !== phrase}
                        onClick={onConfirm}
                        className="cursor-pointer px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function LogViewer({ runId, step, running }) {
    const [text, setText] = useState('');
    const offsetRef = useRef(0);
    const boxRef = useRef(null);
    const stickRef = useRef(true);

    useEffect(() => {
        setText('');
        offsetRef.current = 0;
        stickRef.current = true;
    }, [runId, step]);

    useEffect(() => {
        if (!runId || !step) return undefined;
        let stopped = false;
        let timer = null;
        const poll = async () => {
            let gotText = false;
            try {
                const data = await api(`/jobs/runs/${runId}/log?step=${encodeURIComponent(step)}&offset=${offsetRef.current}`);
                if (stopped) return;
                if (data.text) {
                    gotText = true;
                    offsetRef.current = data.offset;
                    setText((prev) => prev + data.text);
                }
            } catch (_) { /* transient, retry */ }
            if (!stopped && (running || gotText)) timer = setTimeout(poll, running ? 1000 : 200);
        };
        poll();
        return () => { stopped = true; if (timer) clearTimeout(timer); };
    }, [runId, step, running]);

    useEffect(() => {
        const el = boxRef.current;
        if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    }, [text]);

    return (
        <pre
            ref={boxRef}
            onScroll={(e) => {
                const el = e.currentTarget;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="bg-slate-900 text-slate-100 text-xs font-mono rounded-md p-3 min-h-[4rem] max-h-80 overflow-auto whitespace-pre-wrap break-words"
        >
            {text || (running ? 'Waiting for output…' : 'No output.')}
        </pre>
    );
}

// Polls the runs of one kind ("deploy" | "discover"), follows the active run, and tracks which step's log is shown.
export function useJobs(kind, onFinished) {
    const [runs, setRuns] = useState([]);
    const [activeRunId, setActiveRunId] = useState(null);
    const [selectedRunId, setSelectedRunId] = useState(null);
    const [selectedStep, setSelectedStep] = useState(null);
    const [nowMs, setNowMs] = useState(Date.now());
    const [error, setError] = useState('');
    const userPickedStep = useRef(false);
    const wasActive = useRef(false);
    const finishedRef = useRef(onFinished);
    finishedRef.current = onFinished;

    const reload = useCallback(async () => {
        try {
            const data = await api(`/jobs/runs?kind=${kind}`);
            setRuns(data.runs);
            setActiveRunId(data.active_run_id);
        } catch (e) { setError(e.message); }
    }, [kind]);

    useEffect(() => { reload(); }, [reload]);
    useEffect(() => {
        const id = setInterval(reload, activeRunId ? 1500 : 10000);
        return () => clearInterval(id);
    }, [activeRunId, reload]);
    useEffect(() => {
        if (wasActive.current && !activeRunId && finishedRef.current) finishedRef.current();
        wasActive.current = !!activeRunId;
    }, [activeRunId]);
    useEffect(() => {
        if (!activeRunId) return undefined;
        const id = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(id);
    }, [activeRunId]);

    // The active job may belong to another kind (only one job runs at a time across all of them).
    const activeHere = runs.some((r) => r.id === activeRunId);
    useEffect(() => {
        if (activeHere) { setSelectedRunId(activeRunId); return; }
        setSelectedRunId((cur) => cur || (runs[0] && runs[0].id) || null);
    }, [activeHere, activeRunId, runs]);

    const selectedRun = runs.find((r) => r.id === selectedRunId) || null;

    useEffect(() => { userPickedStep.current = false; }, [selectedRunId]);
    useEffect(() => {
        if (!selectedRun) { setSelectedStep(null); return; }
        if (userPickedStep.current) return;
        const steps = selectedRun.steps;
        const pick = steps.find((s) => s.status === 'running')
            || steps.find((s) => s.status === 'failed')
            || [...steps].reverse().find((s) => s.status !== 'pending' && s.status !== 'skipped')
            || steps[0];
        setSelectedStep(pick ? pick.name : null);
    }, [selectedRun]);

    const pickStep = (name) => { userPickedStep.current = true; setSelectedStep(name); };
    const cancel = async () => {
        try { await api(`/jobs/runs/${activeRunId}/cancel`, { method: 'POST' }); await reload(); } catch (e) { setError(e.message); }
    };
    const started = async (runId) => { setSelectedRunId(runId); await reload(); };

    return {
        runs, activeRunId, activeHere, busy: !!activeRunId, selectedRun, selectedRunId, selectedStep,
        nowMs, error, setError, reload, cancel, pickStep, selectRun: setSelectedRunId, started,
    };
}

export function BusyNotice({ jobs }) {
    if (!jobs.busy || jobs.activeHere) return null;
    return (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded p-3">
            Another job is running (only one job runs at a time). It will show up here once it finishes, or open its page to watch it.
        </div>
    );
}

function Bar({ pct, tone = 'blue' }) {
    const color = tone === 'green' ? 'bg-green-500' : 'bg-blue-500';
    return (
        <div className="h-1.5 bg-slate-100 rounded overflow-hidden">
            <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
    );
}

function fmtTypical(secs) {
    if (!secs) return null;
    return secs >= 90 ? `~${Math.round(secs / 60)} min` : `~${secs}s`;
}

// Real progress only: a bar is drawn when we have a real done/total or percent, otherwise just where we are.
function ProgressBlock({ step }) {
    const p = step.progress;
    const phase = p && p.phase;
    const sub = p && p.sub;
    const typical = fmtTypical(step.typical_seconds);
    if (!phase && !sub && !typical) return null;

    let where = null;
    let stepPct = null;
    if (phase) {
        if (phase.index && phase.of) {
            where = `Step ${phase.index} of ${phase.of} · ${phase.label}`;
            stepPct = ((phase.index - 1) / phase.of) * 100;
        } else if (phase.total) {
            const done = Math.round(phase.done ?? 0);
            where = `${phase.label}: ${done} of ${Math.round(phase.total)} ${phase.unit || ''}`.trim();
            stepPct = (Math.min(done, phase.total) / phase.total) * 100;
        } else {
            where = phase.label;
        }
    }
    return (
        <div className="mt-2 space-y-1.5">
            {where && (
                <div>
                    <div className="text-xs text-slate-600 mb-1 truncate" title={where}>{where}</div>
                    {phase && phase.note && (
                        <div className="text-xs text-slate-500 mb-1 truncate" title={phase.note}>{phase.note}</div>
                    )}
                    {stepPct !== null && <Bar pct={stepPct} />}
                </div>
            )}
            {sub && (
                <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>{Math.round(sub.pct)}%</span>
                        <span>{sub.eta ? `ETA ${sub.eta}` : ''}</span>
                    </div>
                    <Bar pct={sub.pct} tone="green" />
                </div>
            )}
            {typical && step.status === 'running' && !sub && (
                <div className="text-xs text-slate-400">usually takes {typical}</div>
            )}
        </div>
    );
}

const ITEM_STATE = {
    pending: { icon: '·', cls: 'text-slate-400', text: 'queued' },
    running: { icon: null, cls: 'text-blue-600', text: 'running' },
    done: { icon: '✓', cls: 'text-green-600', text: 'done' },
    skipped: { icon: '–', cls: 'text-slate-400', text: 'skipped' },
    submitted: { icon: '⏳', cls: 'text-amber-600', text: 'submitted' },
    waiting: { icon: '⏳', cls: 'text-amber-600', text: 'waiting' },
    failed: { icon: '✗', cls: 'text-red-600', text: 'failed' },
    cancelled: { icon: '■', cls: 'text-amber-600', text: 'cancelled' },
};

// What each folder is doing in a run over several folders (queued, running, submitted, waiting, done, ...).
export function FolderChecklist({ items }) {
    if (!Array.isArray(items) || items.length < 2) return null;
    return (
        <ul className="mt-2 max-h-44 overflow-auto rounded border border-slate-100 divide-y divide-slate-50 bg-white" data-testid="folder-checklist">
            {items.map((i) => {
                const st = ITEM_STATE[i.state] || ITEM_STATE.pending;
                return (
                    <li key={i.name} data-state={i.state} className="flex items-center gap-2 px-2 py-1 text-xs">
                        <span className={`w-4 text-center shrink-0 ${st.cls}`} aria-hidden="true">
                            {st.icon || <span className="inline-block w-2.5 h-2.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-slate-700" title={i.name}>{i.name}</span>
                        <span className={`shrink-0 ${st.cls}`}>{i.note || st.text}</span>
                    </li>
                );
            })}
        </ul>
    );
}

export function RunPanel({ jobs, onRetry }) {
    const [logOpen, setLogOpen] = useState({}); // "runId:step" -> user's choice; unset = open only for failed steps
    const run = jobs.selectedRun;
    if (!run) return null;
    const step = run.steps.find((s) => s.name === jobs.selectedStep);
    const logKey = step ? `${run.id}:${step.name}` : '';
    const showLog = step ? (logOpen[logKey] ?? step.status === 'failed') : false;
    return (
        <Card
            title={`Run ${run.id}`}
            right={
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">started {timeAgo(run.created_at)}</span>
                    <StatusBadge status={run.status} />
                    {run.id === jobs.activeRunId && (
                        <button onClick={jobs.cancel} className="cursor-pointer text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50">Cancel</button>
                    )}
                </div>
            }
        >
            {run.status === 'waiting' && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded p-3 mb-3">
                    Not finished, but nothing failed. Some work is still running elsewhere (e.g. an LLM batch job). Come back later and start it again; it picks up where it left off.
                </div>
            )}
            <div className="space-y-2 mb-4">
                {run.steps.map((s) => (
                    <div
                        key={s.name}
                        onClick={() => jobs.pickStep(s.name)}
                        className={`flex items-center gap-3 rounded border px-3 py-2 cursor-pointer ${jobs.selectedStep === s.name ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 hover:bg-slate-50'}`}
                    >
                        <StatusBadge status={s.status} />
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-700 truncate">{s.title || s.name}</div>
                            {s.status === 'running' && <ProgressBlock step={s} />}
                            {s.status !== 'pending' && s.status !== 'skipped' && <FolderChecklist items={s.progress?.phase?.items} />}
                            {s.detail && s.status !== 'pending' && s.status !== 'skipped' && !(s.status === 'running' && s.progress?.sub) && (
                                <div className={`text-xs text-slate-500 font-mono ${['waiting', 'failed'].includes(s.status) ? 'break-words' : 'truncate'}`}>{s.detail}</div>
                            )}
                        </div>
                        <div className="text-xs text-slate-500 tabular-nums">{formatDuration(s.started_at, s.finished_at, jobs.nowMs)}</div>
                        {onRetry && (s.status === 'failed' || s.status === 'cancelled') && !jobs.busy && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onRetry(run, s.name); }}
                                className="cursor-pointer text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-white"
                            >
                                Retry from here
                            </button>
                        )}
                    </div>
                ))}
            </div>
            {step && (
                <>
                    <button
                        onClick={() => setLogOpen((cur) => ({ ...cur, [logKey]: !showLog }))}
                        className="cursor-pointer text-xs text-blue-600 hover:underline"
                    >
                        {showLog ? 'Hide' : 'Show'} log — {step.title || step.name}
                    </button>
                    {showLog && <div className="mt-1"><LogViewer runId={run.id} step={step.name} running={step.status === 'running'} /></div>}
                </>
            )}
        </Card>
    );
}

export function JobHistory({ jobs }) {
    if (jobs.runs.length === 0) return null;
    return (
        <Card title="History">
            <div className="divide-y divide-slate-100">
                {jobs.runs.map((r) => (
                    <div
                        key={r.id}
                        onClick={() => jobs.selectRun(r.id)}
                        className={`flex items-center gap-3 py-2 px-2 cursor-pointer text-sm ${r.id === jobs.selectedRunId ? 'bg-blue-50/40' : 'hover:bg-slate-50'}`}
                    >
                        <StatusBadge status={r.status} />
                        <span className="flex-1 truncate text-slate-700">{r.label}</span>
                        <span className="text-xs text-slate-400">{timeAgo(r.created_at)}</span>
                        <span className="text-xs text-slate-500 tabular-nums w-14 text-right">{formatDuration(r.created_at, r.finished_at, jobs.nowMs)}</span>
                    </div>
                ))}
            </div>
        </Card>
    );
}
