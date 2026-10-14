import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, postJson, ConfirmModal } from './JobUI';
import { useOutsideClick } from '../../hooks/useOutsideClick';

export const expiryDate = value => value ? new Date(value).toLocaleString(undefined, { timeZoneName: 'short' }) : 'Unknown';

export function httpsSummary(report, now = Date.now()) {
    if (!report?.reachable || !Array.isArray(report.endpoints) || !report.endpoints.length) return { state: 'unknown' };
    const endpoints = report.endpoints;
    if (endpoints.some(item => !item.expires_at || !Number.isFinite(Date.parse(item.expires_at)))) return { state: 'unknown' };
    const expires = Math.min(...endpoints.map(item => Date.parse(item.expires_at)));
    const days = (expires - now) / 86400000;
    return { state: days > 30 ? 'green' : days >= 10 ? 'orange' : 'red', expires: new Date(expires).toISOString(),
        days: Math.max(0, Math.floor(days)), expired: days <= 0,
        warning: endpoints.some(item => !item.valid || item.matches_disk === false)
            || !!report.renewal?.error || report.renewal?.timer?.ActiveState !== 'active'
            || (report.renewal?.service?.Result && report.renewal.service.Result !== 'success') };
}

export function useHttpsStatus() {
    const [report, setReport] = useState(null);
    const [error, setError] = useState('');
    const [starting, setStarting] = useState(false);
    const [renewError, setRenewError] = useState('');
    const [runId, setRunId] = useState(null);
    const inFlight = useRef(false);
    const renewing = useRef(false);
    const refresh = useCallback(async (fresh = false) => {
        if (inFlight.current) return;
        inFlight.current = true;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 70000);
        try {
            const data = await api(`/deploy/production${fresh ? '?fresh=true' : ''}`, { signal: controller.signal });
            setReport(data);
            setError(data.reachable ? '' : data.error || 'Production unavailable');
        } catch (err) { setError(err.message); }
        finally { clearTimeout(timeout); inFlight.current = false; }
    }, []);
    useEffect(() => {
        refresh();
        const timer = setInterval(() => refresh(), 60000);
        return () => clearInterval(timer);
    }, [refresh]);
    const renew = useCallback(async () => {
        if (renewing.current) return;
        renewing.current = true;
        setStarting(true);
        setRenewError('');
        try {
            const data = await postJson('/deploy/production/renew', { confirmation: 'prod' });
            setRunId(data.run_id);
        } catch (err) { setRenewError(err.message); }
        finally { renewing.current = false; setStarting(false); }
    }, []);
    return { report, error, starting, renewError, runId, refresh, renew };
}

export function RenewalConfirmation({ onConfirm, onCancel }) {
    return <ConfirmModal title="Renew production HTTPS credentials?" phrase="prod" confirmLabel="Renew credentials"
        lines={['Prepare and test webroot validation for all three domains.',
            'Renew the certificate if due, validate Nginx and gracefully reload it.',
            'Verify live HTTPS and show progress on the Production tab. The website stays online.']}
        onConfirm={onConfirm} onCancel={onCancel} />;
}

export default function HttpsPill({ https }) {
    const [open, setOpen] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const ref = useRef(null);
    const navigate = useNavigate();
    useOutsideClick(ref, () => setOpen(false), { enabled: open && !confirm });
    useEffect(() => {
        const close = event => { if (event.key === 'Escape') { setOpen(false); setConfirm(false); } };
        window.addEventListener('keydown', close);
        return () => window.removeEventListener('keydown', close);
    }, []);
    const summary = https.error ? { state: 'unknown' } : httpsSummary(https.report);
    const colors = { green: 'bg-emerald-400', orange: 'bg-orange-400', red: 'bg-red-500', unknown: 'bg-slate-500' };
    const label = summary.state === 'unknown' ? 'HTTPS ?' : summary.expired ? 'HTTPS · expired' : `HTTPS · ${summary.days} days`;
    return <div ref={ref} className="relative">
        <button data-testid="https-pill" data-state={summary.state} aria-haspopup="dialog" aria-expanded={open}
            title={summary.expires ? `HTTPS expires ${expiryDate(summary.expires)}${summary.warning ? ' · Renewal or HTTPS needs attention' : ''}` : https.error || 'Checking HTTPS credentials…'}
            onClick={() => setOpen(value => !value)}
            className="flex items-center gap-1.5 whitespace-nowrap text-xs px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-slate-100">
            <span aria-hidden="true" className={`w-2 h-2 rounded-full ${colors[summary.state]}`} />
            {label}{summary.warning && <span aria-label="HTTPS needs attention">⚠</span>}
        </button>
        {open && <div role="dialog" aria-label="HTTPS credentials" data-esc-owner
            className="absolute right-0 top-full mt-1.5 z-50 w-80 max-w-[90vw] rounded-md border border-slate-200 bg-white text-slate-700 shadow-lg p-3 space-y-2 text-sm">
            <p className="font-semibold">Production HTTPS</p>
            <p>Expires: {expiryDate(summary.expires)}</p>
            <p className="text-xs break-words">{https.report?.endpoints?.map(item => item.domain).join(', ')}</p>
            {summary.warning && <p className="text-xs text-orange-700">Renewal or HTTPS needs attention. See Production for details.</p>}
            {https.error && <p role="alert" className="text-xs text-red-700">{https.error}</p>}
            <p className="text-xs text-slate-500">Last checked: {expiryDate(https.report?.checked_at)}</p>
            <div className="flex gap-3 items-center">
                <button disabled={https.starting} onClick={() => { setOpen(false); setConfirm(true); }} className="rounded bg-blue-600 text-white text-xs px-3 py-1.5 disabled:opacity-50">Renew credentials</button>
                <Link to="/prod/certificates" onClick={() => setOpen(false)} className="text-xs text-blue-700">View production</Link>
            </div>
        </div>}
        {confirm && <RenewalConfirmation onCancel={() => setConfirm(false)} onConfirm={() => {
            setConfirm(false); setOpen(false);
            navigate('/prod/certificates');
            https.renew();
        }} />}
    </div>;
}
