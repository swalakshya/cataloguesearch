import React, { useEffect, useRef, useState } from 'react';
import { api } from './JobUI';

const ACTIVE = new Set(['waiting', 'ready', 'building', 'restarting']);

export default function DashboardUpdate() {
    const [status, setStatus] = useState(null);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const instance = useRef(null);
    const requested = useRef(false);

    useEffect(() => {
        let alive = true;
        let timer;
        let controller;
        const refresh = async () => {
            controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
                const data = await api('/dashboard/status', { signal: controller.signal });
                if (!alive) return;
                if (data.enabled) {
                    if (instance.current && data.instance !== instance.current) {
                        window.location.reload();
                        return;
                    }
                    instance.current = data.instance;
                    requested.current = ACTIVE.has(data.phase);
                }
                setStatus(data);
                setError('');
            } catch (err) {
                if (alive && requested.current) setError('Dashboard is reconnecting…');
            } finally {
                clearTimeout(timeout);
                if (alive) timer = setTimeout(refresh, requested.current ? 1000 : 5000);
            }
        };
        refresh();
        return () => { alive = false; clearTimeout(timer); controller?.abort(); };
    }, []);

    if (!status?.enabled) return null;
    const active = ACTIVE.has(status.phase);
    const apply = async () => {
        setSubmitting(true);
        setError('');
        requested.current = true;
        try {
            await api('/dashboard/update', { method: 'POST' });
            setStatus(previous => ({ ...previous, phase: 'waiting' }));
        } catch (err) { requested.current = false; setError(err.message); }
        finally { setSubmitting(false); }
    };
    if (!status.available && !active && !error && status.phase !== 'error') return null;
    const label = submitting ? 'Queuing update…' : status.phase === 'waiting' ? 'Update queued · waiting for jobs'
        : active ? 'Updating dashboard…' : 'Update available';
    return <div className="relative group">
        <button onClick={apply} disabled={active || submitting}
            className="text-xs whitespace-nowrap rounded-full px-2.5 py-1 bg-amber-400/20 text-amber-200 hover:bg-amber-400/30 disabled:cursor-wait"
            title={status.message || 'Apply dashboard code changes after all running jobs finish. UI changes are rebuilt; the browser reconnects automatically.'}>
            {label}
        </button>
        {(error || status.phase === 'error') && <p role="alert" className="absolute right-0 top-full mt-2 z-50 bg-white text-red-700 border rounded p-3 shadow w-80 text-xs">
            {error || status.message}
        </p>}
    </div>;
}
