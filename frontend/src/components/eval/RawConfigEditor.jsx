import React, { useState, useEffect, useCallback } from 'react';

// "Edit scan_config.json" / "Edit config.json" popup: opens the whole file this PDF's own settings live in as raw
// text, validates it as JSON on save, and writes it back exactly as typed -- no reformatting, so nothing else in a
// hand-formatted file changes. Only available when that file is in the configs repo (git checkout); otherwise it
// opens read-only. Reuses the eval API's own base URL, passed in rather than imported, to stay easy to test.

const KIND_LABEL = { scan_config: 'scan_config.json', config: 'config.json' };

export default function RawConfigEditor({ apiBaseUrl, relativePath, kind, onClose, onSaved }) {
    const [state, setState] = useState({ status: 'loading' }); // loading | ready | load-error
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [saved, setSaved] = useState(false);

    const load = useCallback(async () => {
        setState({ status: 'loading' });
        setSaved(false);
        setSaveError('');
        try {
            const res = await fetch(`${apiBaseUrl}/eval/ocr/raw-config?relative_path=${encodeURIComponent(relativePath)}&kind=${kind}`);
            const body = await res.json().catch(() => null);
            if (!res.ok) throw new Error((body && body.detail) || `HTTP ${res.status}`);
            setState({ status: 'ready', info: body });
            setText(body.text);
        } catch (e) {
            setState({ status: 'load-error', message: e.message });
        }
    }, [apiBaseUrl, relativePath, kind]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const jsonError = (() => {
        try {
            const parsed = JSON.parse(text);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                return 'The file must be a JSON object ({...}), not a list or a bare value.';
            }
            return '';
        } catch (e) {
            return e.message;
        }
    })();

    const save = async () => {
        if (state.status !== 'ready' || jsonError) return;
        setSaving(true);
        setSaveError('');
        setSaved(false);
        try {
            const res = await fetch(`${apiBaseUrl}/eval/ocr/raw-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ relative_path: relativePath, kind, text, expected_hash: state.info.hash }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) throw new Error((body && body.detail) || `HTTP ${res.status}`);
            setState({ status: 'ready', info: body });
            setText(body.text);
            setSaved(true);
            if (onSaved) onSaved(body);
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const label = KIND_LABEL[kind] || kind;
    const info = state.status === 'ready' ? state.info : null;
    const readOnly = !!info && !info.editable;
    const dirty = info && text !== info.text;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl h-[80vh] flex flex-col"
                role="dialog" aria-modal="true" aria-label={`Edit ${label}`} data-esc-owner>
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-slate-800">{label}</h2>
                        {info && <p className="text-xs text-slate-500 truncate font-mono" title={info.file}>{info.file}{!info.exists && ' (does not exist yet)'}</p>}
                    </div>
                    <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 text-xl leading-none px-1" aria-label="Close editor">×</button>
                </div>

                <div className="flex-1 min-h-0 flex flex-col p-4 gap-2">
                    {state.status === 'loading' && <p className="text-sm text-slate-400">Loading…</p>}
                    {state.status === 'load-error' && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3" role="alert">
                            Could not load {label}: {state.message}
                        </div>
                    )}
                    {info && readOnly && (
                        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2.5" data-testid="read-only-notice">
                            Read-only: {info.reason}
                        </div>
                    )}
                    {info && (
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            readOnly={readOnly}
                            spellCheck={false}
                            aria-label={`${label} contents`}
                            className={`flex-1 min-h-0 w-full font-mono text-xs border rounded p-3 resize-none ${
                                jsonError ? 'border-red-400' : 'border-slate-300'} ${readOnly ? 'bg-slate-50 text-slate-500' : 'bg-white'}`}
                        />
                    )}
                    {info && jsonError && !readOnly && (
                        <p className="text-xs text-red-700" data-testid="json-error">{jsonError}</p>
                    )}
                    {saveError && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-1.5" role="alert">{saveError}</div>
                    )}
                    {saved && !dirty && (
                        <p className="text-sm text-emerald-700" data-testid="saved-note">Saved.</p>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-slate-200">
                    {state.status === 'load-error' && (
                        <button onClick={load} className="cursor-pointer px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-600 hover:bg-slate-50">Retry</button>
                    )}
                    <button onClick={onClose} className="cursor-pointer px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-600 hover:bg-slate-50">Close</button>
                    {!readOnly && state.status === 'ready' && (
                        <button onClick={save} disabled={saving || !!jsonError}
                            className="cursor-pointer px-4 py-1.5 text-sm rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed">
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
