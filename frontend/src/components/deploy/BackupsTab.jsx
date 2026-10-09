import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, postJson, Card, ErrorBanner, useJobs, BusyNotice, RunPanel, JobHistory } from '../dev/JobUI';
import { useDevShell } from '../dev/DevShell';

export default function BackupsTab() {
    const [status, setStatus] = useState(null);
    const [folders, setFolders] = useState(null);
    const [error, setError] = useState('');
    const [folderError, setFolderError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const popupRef = useRef(null);
    const openedUrlRef = useRef(null);
    const dockerBlocked = !!useDevShell().docker?.blocked;
    const loadStatus = useCallback(async () => {
        try { setStatus(await api('/deploy/backups/status')); } catch (e) { setError(e.message); }
    }, []);
    const loadFolders = useCallback(async () => {
        setFolderError('');
        try { setFolders(await api('/deploy/backups/folders')); } catch (e) { setFolderError(e.message); }
    }, []);
    const jobs = useJobs('backup', () => { loadStatus(); loadFolders(); });
    useEffect(() => { loadStatus(); }, [loadStatus]);
    useEffect(() => {
        const timer = setInterval(loadStatus, status?.connection_state === 'connecting' ? 1000 : 10000);
        return () => clearInterval(timer);
    }, [loadStatus, status?.connection_state]);
    useEffect(() => {
        if (status?.connected) loadFolders();
        else setFolders(null);
    }, [status?.connected, status?.date, loadFolders]);
    useEffect(() => {
        if (status?.auth_url && popupRef.current && openedUrlRef.current !== status.auth_url) {
            try {
                popupRef.current.location.href = status.auth_url;
                openedUrlRef.current = status.auth_url;
            } catch (_) { /* The explicit sign-in link remains available if popups are blocked. */ }
        }
    }, [status?.auth_url]);
    const connect = async () => {
        setError('');
        // Reserve the window during the user click; opening after an async poll is often blocked.
        popupRef.current = window.open('about:blank', '_blank');
        if (popupRef.current) popupRef.current.opener = null;
        openedUrlRef.current = null;
        try { setStatus(await postJson('/deploy/backups/connect', {})); }
        catch (e) { popupRef.current?.close(); setError(e.message); }
    };
    const submit = async () => {
        setSubmitting(true); setError(''); jobs.setError('');
        try {
            const { run_id: runId } = await postJson('/deploy/backups/runs', {});
            await jobs.started(runId);
        } catch (e) { setError(e.message); }
        finally { setSubmitting(false); }
    };
    const connecting = status?.connection_state === 'connecting';
    const unavailable = !status?.rclone_available;
    const busy = jobs.busy || submitting;
    const blocked = busy || unavailable || !status?.connected || connecting || !status?.source_exists || dockerBlocked || !folders || !!folderError;

    return <div className="space-y-4">
        <ErrorBanner message={status?.error || status?.connection_error || error || folderError || jobs.error} onClose={() => { setError(''); jobs.setError(''); }} />
        <BusyNotice jobs={jobs} />
        <Card title="Google Drive backups" right={<button onClick={() => { loadStatus(); if (status?.connected) loadFolders(); }} className="cursor-pointer text-xs text-blue-600 hover:underline">Refresh</button>}>
            {!status ? <p className="text-sm text-slate-500">Checking backup tools…</p> : <div className="space-y-4 text-sm text-slate-700">
                <div>
                    <p><span className="font-medium">Source:</span> {status.source}</p>
                    <p><span className="font-medium">Destination:</span> {status.destination}/{status.date}</p>
                    <p className="mt-2 font-mono text-xs">cataloguesearch_{status.date}.tar.zst</p>
                    <p className="font-mono text-xs">snapshots_{status.date}.tar.zst</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <p>{status.connected ? 'Google Drive connected.' : 'Google Drive is not connected.'}</p>
                    <button type="button" disabled={unavailable || busy || connecting} onClick={connect}
                        className="cursor-pointer rounded border border-slate-300 px-3 py-1.5 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed">
                        {status.connected ? 'Reconnect Google Drive' : 'Connect Google Drive'}
                    </button>
                    {connecting && <div className="space-y-2">
                        <p>Complete Google sign-in in the new window. This page updates automatically.</p>
                        {status.auth_url ? <a href={status.auth_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Open Google sign-in</a> : <p>Waiting for the sign-in link…</p>}
                        <button type="button" onClick={async () => { try { setStatus(await postJson('/deploy/backups/connect/cancel', {})); popupRef.current?.close(); } catch (e) { setError(e.message); } }} className="ml-3 cursor-pointer text-slate-500 underline">Cancel connection</button>
                    </div>}
                </div>
                <div>
                    <p className="font-medium">Keep latest {status.keep_latest} dated folders, including this backup.</p>
                    <p className="mt-1 text-xs text-slate-500">Older dated folders move to Google Drive trash only after both archives upload and verify successfully.</p>
                    {folders && <div className="mt-2 text-xs">
                        {folders.remove_after_upload.length ? <><p>Folders to remove after a successful upload:</p><ul className="list-disc pl-5 mt-1">{folders.remove_after_upload.map(date => <li key={date}>{date}</li>)}</ul></> : <p>No older dated folders need removal.</p>}
                    </div>}
                </div>
                <p className="text-xs text-slate-500">Fresh snapshots briefly restart local OpenSearch and rebuild its snapshot folder. Local archives are kept at {status.output_directory}. Repeat runs on the same date replace that date’s archive files after staged uploads verify.</p>
                {!status.source_exists && <p className="text-red-600">The source directory does not exist.</p>}
                {dockerBlocked && <p className="text-amber-700">Local Docker must be ready to generate fresh snapshots.</p>}
                {submitting && <p role="status" className="text-sm text-slate-600">Preparing backup job… Checking local tools and Docker. Live step progress and logs will appear below.</p>}
                <button type="button" onClick={submit} disabled={blocked}
                    className="cursor-pointer rounded bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">{submitting ? 'Starting…' : 'Submit'}</button>
            </div>}
        </Card>
        <RunPanel jobs={jobs} />
        <JobHistory jobs={jobs} />
    </div>;
}
