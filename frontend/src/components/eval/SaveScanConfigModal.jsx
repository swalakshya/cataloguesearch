import React, { useState, useEffect, useCallback } from 'react';

// "Save to scan_config.json" popup: shows what each control was when the file was last loaded next to what it is
// now, then writes the current values into the PDF's own entry (only touching those keys) when confirmed. Only
// available when that file is in the configs repo; otherwise it opens read-only, matching the other scan_config
// edits in PDF Parser.

export default function SaveScanConfigModal({ apiBaseUrl, relativePath, values, removeKeys, changes, onClose, onSaved }) {
    const [state, setState] = useState({ status: 'loading' }); // loading | ready | load-error
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [saved, setSaved] = useState(false);

    const load = useCallback(async () => {
        setState({ status: 'loading' });
        try {
            const res = await fetch(`${apiBaseUrl}/eval/ocr/raw-config?relative_path=${encodeURIComponent(relativePath)}&kind=scan_config`);
            const body = await res.json().catch(() => null);
            if (!res.ok) throw new Error((body && body.detail) || `HTTP ${res.status}`);
            setState({ status: 'ready', info: body });
        } catch (e) {
            setState({ status: 'load-error', message: e.message });
        }
    }, [apiBaseUrl, relativePath]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const save = async () => {
        if (state.status !== 'ready') return;
        setSaving(true);
        setSaveError('');
        setSaved(false);
        try {
            const res = await fetch(`${apiBaseUrl}/eval/ocr/scan-config/controls`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ relative_path: relativePath, values, remove_keys: removeKeys, expected_hash: state.info.hash }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) throw new Error((body && body.detail) || `HTTP ${res.status}`);
            setSaved(true);
            if (onSaved) onSaved(body);
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const info = state.status === 'ready' ? state.info : null;
    const readOnly = !!info && !info.editable;
    const anyChanged = changes.some((c) => c.changed);

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg" role="dialog" aria-modal="true" aria-label="Save to scan_config.json" data-esc-owner>
                <div className="px-4 py-2.5 border-b border-slate-200">
                    <h2 className="text-base font-semibold text-slate-800">Save to scan_config.json</h2>
                    {info && <p className="text-xs text-slate-500 truncate font-mono" title={info.file}>{info.file}</p>}
                </div>

                <div className="p-4 space-y-3">
                    {state.status === 'loading' && <p className="text-sm text-slate-400">Loading…</p>}
                    {state.status === 'load-error' && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3" role="alert">
                            Could not open scan_config.json: {state.message}
                        </div>
                    )}
                    {info && readOnly && (
                        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2.5" data-testid="read-only-notice">
                            Read-only: {info.reason}
                        </div>
                    )}
                    {info && (
                        <table className="w-full text-sm" data-testid="changes-table">
                            <tbody>
                                {changes.map((c) => (
                                    <tr key={c.label} data-testid={`row-${c.label}`} data-changed={c.changed}>
                                        <td className={`py-1 pr-3 font-medium whitespace-nowrap ${c.changed ? 'text-slate-800' : 'text-slate-400'}`}>{c.label}</td>
                                        <td className={`py-1 pr-2 font-mono text-xs ${c.changed ? 'text-slate-400 line-through' : 'text-slate-500'}`}>{c.before}</td>
                                        <td className="py-1 font-mono text-xs text-emerald-700">{c.changed ? `→ ${c.after}` : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {info && !anyChanged && (
                        <p className="text-xs text-slate-400">Nothing has changed since this file was loaded; saving just confirms the current values.</p>
                    )}
                    {saveError && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-1.5" role="alert">{saveError}</div>
                    )}
                    {saved && <p className="text-sm text-emerald-700" data-testid="saved-note">Saved.</p>}
                </div>

                <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-slate-200">
                    {state.status === 'load-error' && (
                        <button onClick={load} className="cursor-pointer px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-600 hover:bg-slate-50">Retry</button>
                    )}
                    <button onClick={onClose} className="cursor-pointer px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-600 hover:bg-slate-50">
                        {saved ? 'Close' : 'Cancel'}
                    </button>
                    {!readOnly && state.status === 'ready' && !saved && (
                        <button onClick={save} disabled={saving}
                            className="cursor-pointer px-4 py-1.5 text-sm rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed">
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
