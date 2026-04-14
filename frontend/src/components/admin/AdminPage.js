import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../../services/api';

const AGENT_PARAM_META = {
    rerank_oversample: { label: 'Rerank oversample (top-k)', type: 'number', min: 10, max: 200, step: 5 },
    rerank_batch_size: { label: 'Rerank batch size',         type: 'number', min: 1,  max: 64,  step: 1 },
    rerank_max_length: { label: 'Rerank max token length',   type: 'number', min: 64, max: 4096, step: 64 },
};

const PARAM_META = {
    rerank_batch_size:   { label: 'Rerank batch size',        type: 'number', min: 1,   max: 64,  step: 1 },
    rerank_max_length:   { label: 'Rerank max token length',  type: 'number', min: 64,  max: 4096, step: 64 },
    rerank_oversample:   { label: 'Rerank oversample (top-k)', type: 'number', min: 10, max: 200, step: 5 },
    ef_search:           { label: 'FAISS ef_search',          type: 'number', min: 16,  max: 512, step: 16 },
    search_mode:         { label: 'Search mode',              type: 'select', options: ['auto', 'lexical', 'vector', 'rrf'], tooltip: 'auto: uses a heuristic — queries with <4 words and no punctuation use BM25 (lexical); longer queries or those with punctuation (?, ।) use kNN (vector). "lexical" or "vector" forces that mode for all queries. "rrf" runs both BM25 and kNN then fuses ranked lists via Reciprocal Rank Fusion for best hybrid recall.' },
    page_size_pravachan: { label: 'Page size — Pravachan',    type: 'number', min: 5,   max: 100, step: 5 },
    page_size_granth:    { label: 'Page size — Granth',       type: 'number', min: 5,   max: 100, step: 5 },
    page_size_books:     { label: 'Page size — Books',        type: 'number', min: 5,   max: 100, step: 5 },
    spelling_min_score:  { label: 'Spelling suggestion min score', type: 'number', min: 0, max: 1, step: 0.05 },
    enable_reranking:    { label: 'Enable reranking',         type: 'boolean' },
    active_categories:   { label: 'Default active categories', type: 'multiselect', options: ['Pravachan', 'Granth', 'Books'] },
};

const ConfigRow = ({ paramKey, defaults, overrides, effective, onSave, onReset, metaMap = PARAM_META }) => {
    const meta = metaMap[paramKey];
    const isOverridden = paramKey in overrides;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(effective[paramKey]);

    useEffect(() => { setDraft(effective[paramKey]); }, [effective, paramKey]);

    const handleSave = () => {
        onSave(paramKey, draft);
        setEditing(false);
    };

    const handleReset = () => {
        onReset(paramKey);
        setEditing(false);
    };

    const renderInput = () => {
        if (meta.type === 'boolean') {
            return (
                <select
                    value={draft ? 'true' : 'false'}
                    onChange={e => setDraft(e.target.value === 'true')}
                    className="border border-slate-300 rounded px-2 py-1 text-sm"
                >
                    <option value="true">true</option>
                    <option value="false">false</option>
                </select>
            );
        }
        if (meta.type === 'select') {
            return (
                <select
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    className="border border-slate-300 rounded px-2 py-1 text-sm"
                >
                    {meta.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
            );
        }
        if (meta.type === 'multiselect') {
            return (
                <div className="flex gap-2">
                    {meta.options.map(o => (
                        <label key={o} className="flex items-center gap-1 text-sm">
                            <input
                                type="checkbox"
                                checked={draft.includes(o)}
                                onChange={e => {
                                    setDraft(prev =>
                                        e.target.checked ? [...prev, o] : prev.filter(v => v !== o)
                                    );
                                }}
                            />
                            {o}
                        </label>
                    ))}
                </div>
            );
        }
        return (
            <input
                type="number"
                value={draft}
                min={meta.min}
                max={meta.max}
                step={meta.step}
                onChange={e => setDraft(meta.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
                className="border border-slate-300 rounded px-2 py-1 text-sm w-28"
            />
        );
    };

    const displayValue = (v) => Array.isArray(v) ? v.join(', ') : String(v);

    return (
        <tr className={isOverridden ? 'bg-orange-50' : ''}>
            <td className="px-4 py-2.5 text-sm text-slate-700 whitespace-nowrap">
                {isOverridden && <span className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-2" title="Overridden" />}
                {meta.label}
                {meta.tooltip && (
                    <span className="relative group ml-1.5 inline-block">
                        <span className="cursor-help text-slate-400 hover:text-slate-600 text-xs border border-slate-300 rounded-full w-4 h-4 inline-flex items-center justify-center leading-none">?</span>
                        <span className="pointer-events-none absolute left-0 bottom-full mb-2 w-72 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 whitespace-normal">
                            {meta.tooltip}
                        </span>
                    </span>
                )}
            </td>
            <td className="px-4 py-2.5 text-sm text-slate-400">{displayValue(defaults[paramKey])}</td>
            <td className="px-4 py-2.5 text-sm font-medium text-slate-800">
                {editing ? renderInput() : displayValue(effective[paramKey])}
            </td>
            <td className="px-4 py-2.5 text-sm">
                <div className="flex items-center gap-2">
                    {editing ? (
                        <>
                            <button onClick={handleSave} className="text-xs bg-sky-600 hover:bg-sky-700 text-white px-2 py-1 rounded transition-colors">Save</button>
                            <button onClick={() => { setEditing(false); setDraft(effective); }} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
                        </>
                    ) : (
                        <button onClick={() => setEditing(true)} className="text-xs text-sky-600 hover:text-sky-800">Edit</button>
                    )}
                    {isOverridden && (
                        <button onClick={handleReset} className="text-xs text-red-500 hover:text-red-700">Reset</button>
                    )}
                </div>
            </td>
        </tr>
    );
};

const AdminPage = ({ token, onLogout }) => {
    const [config, setConfig] = useState(null);
    const [error, setError] = useState('');
    const [resetConfirm, setResetConfirm] = useState(false);
    const [agentConfig, setAgentConfig] = useState(null);
    const [agentResetConfirm, setAgentResetConfirm] = useState(false);

    const loadConfig = useCallback(async () => {
        try {
            const data = await api.getAdminConfig(token);
            setConfig(data);
        } catch {
            setError('Session expired. Please log in again.');
            onLogout();
        }
    }, [token, onLogout]);

    const loadAgentConfig = useCallback(async () => {
        try {
            const data = await api.getAgentConfig(token);
            setAgentConfig(data);
        } catch {
            setError('Failed to load agent config.');
        }
    }, [token]);

    useEffect(() => { loadConfig(); loadAgentConfig(); }, [loadConfig, loadAgentConfig]);

    const handleSave = async (key, value) => {
        try {
            await api.updateAdminConfig(token, { [key]: value });
            await Promise.all([loadConfig(), loadAgentConfig()]);
        } catch {
            setError('Failed to save. Please try again.');
        }
    };

    const handleReset = async (key) => {
        try {
            await api.resetAdminConfig(token, key);
            await Promise.all([loadConfig(), loadAgentConfig()]);
        } catch {
            setError('Failed to reset. Please try again.');
        }
    };

    const handleResetAll = async () => {
        try {
            await api.resetAdminConfig(token);
            await Promise.all([loadConfig(), loadAgentConfig()]);
            setResetConfirm(false);
        } catch {
            setError('Failed to reset. Please try again.');
        }
    };

    const handleAgentSave = async (key, value) => {
        try {
            await api.updateAgentConfig(token, { [key]: value });
            await loadAgentConfig();
        } catch {
            setError('Failed to save agent config. Please try again.');
        }
    };

    const handleAgentReset = async (key) => {
        try {
            await api.resetAgentConfig(token, key);
            await loadAgentConfig();
        } catch {
            setError('Failed to reset agent config. Please try again.');
        }
    };

    const handleAgentResetAll = async () => {
        try {
            await api.resetAgentConfig(token);
            await loadAgentConfig();
            setAgentResetConfirm(false);
        } catch {
            setError('Failed to reset agent config. Please try again.');
        }
    };

    if (!config || !agentConfig) {
        return <div className="p-8 text-slate-500 text-sm">Loading…</div>;
    }

    const { defaults, overrides, effective } = config;
    const overrideCount = Object.keys(overrides).length;
    const agentOverrideCount = Object.keys(agentConfig.overrides).length;

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Admin — Search Config</h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                        {overrideCount > 0
                            ? <><span className="text-orange-500 font-medium">{overrideCount} override{overrideCount > 1 ? 's' : ''} active</span> — values differ from config.yaml defaults</>
                            : 'All values are at config.yaml defaults'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {overrideCount > 0 && !resetConfirm && (
                        <button onClick={() => setResetConfirm(true)} className="text-sm text-red-600 hover:text-red-800 border border-red-200 px-3 py-1.5 rounded-lg transition-colors">
                            Reset all to defaults
                        </button>
                    )}
                    {resetConfirm && (
                        <div className="flex items-center gap-2 text-sm">
                            <span className="text-slate-600">Are you sure?</span>
                            <button onClick={handleResetAll} className="text-red-600 hover:text-red-800 font-medium">Yes, reset all</button>
                            <button onClick={() => setResetConfirm(false)} className="text-slate-500">Cancel</button>
                        </div>
                    )}
                    <button onClick={onLogout} className="text-sm text-slate-500 hover:text-slate-700">Log out</button>
                </div>
            </div>

            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Parameter</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Default</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Current</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.keys(PARAM_META).map(key => (
                            <ConfigRow
                                key={key}
                                paramKey={key}
                                defaults={defaults}
                                overrides={overrides}
                                effective={effective}
                                onSave={handleSave}
                                onReset={handleReset}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="text-xs text-slate-400 mt-4">
                Changes take effect immediately. Overrides persist across restarts via <code>configs/overrides.json</code>.
                <span className="inline-block w-2 h-2 rounded-full bg-orange-400 mx-1 mb-0.5" /> = overridden value.
            </p>

            {/* Agent Config */}
            <div className="flex items-center justify-between mt-10 mb-4">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Agent Config</h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                        {agentOverrideCount > 0
                            ? <><span className="text-orange-500 font-medium">{agentOverrideCount} override{agentOverrideCount > 1 ? 's' : ''} active</span> — overrides the inherited Search Config values</>
                            : 'All values inherited from Search Config above'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {agentOverrideCount > 0 && !agentResetConfirm && (
                        <button onClick={() => setAgentResetConfirm(true)} className="text-sm text-red-600 hover:text-red-800 border border-red-200 px-3 py-1.5 rounded-lg transition-colors">
                            Reset all to inherited
                        </button>
                    )}
                    {agentResetConfirm && (
                        <div className="flex items-center gap-2 text-sm">
                            <span className="text-slate-600">Are you sure?</span>
                            <button onClick={handleAgentResetAll} className="text-red-600 hover:text-red-800 font-medium">Yes, reset all</button>
                            <button onClick={() => setAgentResetConfirm(false)} className="text-slate-500">Cancel</button>
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Parameter</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Inherited (Search Config)</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Current</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.keys(AGENT_PARAM_META).map(key => (
                            <ConfigRow
                                key={key}
                                paramKey={key}
                                defaults={agentConfig.defaults}
                                overrides={agentConfig.overrides}
                                effective={agentConfig.effective}
                                onSave={handleAgentSave}
                                onReset={handleAgentReset}
                                metaMap={AGENT_PARAM_META}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="text-xs text-slate-400 mt-4">
                Agent config inherits from Search Config. Override individual values to tune the agent independently.
            </p>
        </div>
    );
};

export default AdminPage;
