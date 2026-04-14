import React, { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

const DEFAULTS = {
    base_api_url: 'http://localhost:8000',
    duration_seconds: 60,
    warmup_seconds: 15,
    max_concurrent: 10,
    query_type: 'rrf',
    page_size: 20,
    rerank_batch_size: 4,
    rerank_block_size: 1500,
    recall_size: 40,
    request_timeout_seconds: 30,
    run_name: '',
};

const BLOCK_SIZE_OPTIONS = [512, 1024, 1500];

function StatBox({ label, value, unit = 'ms' }) {
    return (
        <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            <div className="text-lg font-mono font-semibold text-slate-800">
                {value != null ? `${value}` : '—'}
                {value != null && <span className="text-xs text-slate-400 ml-1">{unit}</span>}
            </div>
        </div>
    );
}

function LatencySection({ title, data }) {
    if (!data) return null;
    return (
        <div>
            <div className="text-sm font-medium text-slate-600 mb-2">{title}</div>
            <div className="grid grid-cols-4 gap-2">
                <StatBox label="Mean" value={data.mean} />
                <StatBox label="P95" value={data.p95} />
                <StatBox label="P99" value={data.p99} />
                <StatBox label="P99.9" value={data.p999} />
            </div>
        </div>
    );
}

function LiveStats({ snapshot }) {
    if (!snapshot) return null;
    return (
        <div className="space-y-4">
            {snapshot.warmup_active && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-700">
                    Warming up — stats recording starts after warmup period completes
                </div>
            )}
            <div className="grid grid-cols-3 gap-3">
                <StatBox label="Queries" value={snapshot.total_queries} unit="" />
                <StatBox label="Throughput" value={snapshot.throughput_qps} unit="qps" />
                <StatBox label="Elapsed" value={snapshot.elapsed_seconds} unit="s" />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <StatBox label="Timeouts" value={snapshot.timeouts} unit="" />
                <StatBox label="Errors" value={snapshot.errors} unit="" />
            </div>
            <LatencySection title="TTFB (first result)" data={snapshot.ttfb} />
            <LatencySection title="Total latency (done event)" data={snapshot.total_latency} />
        </div>
    );
}

export default function LoadTest() {
    const [config, setConfig] = useState({ ...DEFAULTS });
    const [queryFile, setQueryFile] = useState(null);
    const [queryFileError, setQueryFileError] = useState('');
    const [running, setRunning] = useState(false);
    const [snapshot, setSnapshot] = useState(null);
    const [runId, setRunId] = useState(null);
    const [runs, setRuns] = useState([]);
    const [selectedRunId, setSelectedRunId] = useState('');
    const [selectedRun, setSelectedRun] = useState(null);
    const [error, setError] = useState('');
    const [stopping, setStopping] = useState(false);
    const [adminConfig, setAdminConfig] = useState(null);
    const [dirtyInfo, setDirtyInfo] = useState(null);
    const [resetting, setResetting] = useState(false);
    const eventSourceRef = useRef(null);

    const fetchRuns = useCallback(async () => {
        try {
            const resp = await fetch(`${API_BASE_URL}/eval/load-test/runs`);
            if (resp.ok) setRuns(await resp.json());
        } catch (_) {}
    }, []);

    const fetchAdminConfig = useCallback(async (baseApiUrl) => {
        try {
            const url = `${API_BASE_URL}/eval/load-test/admin-config?base_api_url=${encodeURIComponent(baseApiUrl)}`;
            const resp = await fetch(url);
            if (resp.ok) {
                const data = await resp.json();
                setAdminConfig(data.effective);
                setDirtyInfo(data.dirty || null);
            }
        } catch (_) {}
    }, []);

    useEffect(() => {
        fetchRuns();
        fetchAdminConfig(DEFAULTS.base_api_url);
    }, [fetchRuns, fetchAdminConfig]);

    const handleResetConfig = async () => {
        setResetting(true);
        try {
            const resp = await fetch(
                `${API_BASE_URL}/eval/load-test/reset-config?base_api_url=${encodeURIComponent(config.base_api_url)}`,
                { method: 'POST' }
            );
            if (resp.ok) {
                setDirtyInfo(null);
                await fetchAdminConfig(config.base_api_url);
            }
        } catch (_) {}
        setResetting(false);
    };

    const openStatusStream = useCallback((rid) => {
        if (eventSourceRef.current) eventSourceRef.current.close();
        const es = new EventSource(`${API_BASE_URL}/eval/load-test/status`);
        es.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                setSnapshot(data);
                if (data.status !== 'running') {
                    setRunning(false);
                    setStopping(false);
                    es.close();
                    fetchRuns();
                    fetchAdminConfig(config.base_api_url);
                }
            } catch (_) {}
        };
        es.onerror = () => {
            setRunning(false);
            setStopping(false);
            es.close();
            fetchRuns();
        };
        eventSourceRef.current = es;
    }, [fetchRuns]);

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) { setQueryFile(null); setQueryFileError(''); return; }
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!Array.isArray(data.lexical_queries) || !Array.isArray(data.rrf_queries)) {
                throw new Error('Must have "lexical_queries" and "rrf_queries" arrays');
            }
            if (!data.lexical_queries.length || !data.rrf_queries.length) {
                throw new Error('Both query lists must be non-empty');
            }
            setQueryFile(file);
            setQueryFileError('');
        } catch (err) {
            setQueryFile(null);
            setQueryFileError(`Invalid query file: ${err.message}`);
        }
    };

    const handleStart = async () => {
        setError('');
        const formData = new FormData();
        formData.append('config_json', JSON.stringify(config));
        if (queryFile) formData.append('query_file', queryFile);

        try {
            const resp = await fetch(`${API_BASE_URL}/eval/load-test/start`, {
                method: 'POST',
                body: formData,
            });
            const data = await resp.json();
            if (!resp.ok) {
                setError(data.detail || 'Failed to start load test');
                return;
            }
            setRunId(data.run_id);
            setSnapshot(null);
            setRunning(true);
            openStatusStream(data.run_id);
        } catch (err) {
            setError(`Request failed: ${err.message}`);
        }
    };

    const handleStop = async () => {
        setStopping(true);
        try {
            await fetch(`${API_BASE_URL}/eval/load-test/stop`, { method: 'POST' });
        } catch (_) {}
    };

    const handleSelectRun = async (rid) => {
        setSelectedRunId(rid);
        if (!rid) { setSelectedRun(null); return; }
        try {
            const resp = await fetch(`${API_BASE_URL}/eval/load-test/runs/${rid}`);
            if (resp.ok) setSelectedRun(await resp.json());
        } catch (_) {}
    };

    const field = (key, type = 'text', extra = {}) => (
        <input
            type={type}
            value={config[key]}
            onChange={(e) => setConfig(c => ({ ...c, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
            className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            disabled={running}
            {...extra}
        />
    );

    return (
        <div className="space-y-6">

            {/* Current search API config + recovery banner */}
            {adminConfig && (
                <div className={`border rounded-lg p-4 text-sm ${dirtyInfo ? 'bg-red-50 border-red-300' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                            <div className={`font-semibold mb-1 ${dirtyInfo ? 'text-red-700' : 'text-slate-700'}`}>
                                {dirtyInfo
                                    ? '⚠ Search API config may be in a modified state from a previous test'
                                    : 'Current search API config'}
                            </div>
                            <div className="font-mono text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                                <span>rerank_batch_size: <strong>{adminConfig.rerank_batch_size}</strong></span>
                                <span>rerank_max_length: <strong>{adminConfig.rerank_max_length}</strong></span>
                                <span>rerank_oversample: <strong>{adminConfig.rerank_oversample}</strong></span>
                            </div>
                            {dirtyInfo && (
                                <div className="mt-2 text-xs text-red-600">
                                    To restore defaults manually:
                                    <code className="ml-2 bg-red-100 px-2 py-0.5 rounded font-mono">
                                        curl -X POST {API_BASE_URL.replace('/api', '')}/api/eval/load-test/reset-config
                                    </code>
                                </div>
                            )}
                        </div>
                        {dirtyInfo && (
                            <button
                                onClick={handleResetConfig}
                                disabled={resetting}
                                className="shrink-0 bg-red-600 text-white text-xs font-semibold py-1.5 px-3 rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                                {resetting ? 'Resetting…' : 'Reset Now'}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Config Panel */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-800 mb-4">Load Test Configuration</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Target API URL</label>
                        {field('base_api_url')}
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Run Name (optional)</label>
                        {field('run_name')}
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Duration (seconds)</label>
                        {field('duration_seconds', 'number', { min: 10, max: 3600 })}
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Warmup (seconds)</label>
                        {field('warmup_seconds', 'number', { min: 0, max: 300 })}
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Max Concurrent Queries</label>
                        {field('max_concurrent', 'number', { min: 1, max: 100 })}
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Query Type</label>
                        <select
                            value={config.query_type}
                            onChange={(e) => setConfig(c => ({ ...c, query_type: e.target.value }))}
                            disabled={running}
                            className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                            <option value="rrf">RRF (default)</option>
                            <option value="lexical">Lexical (BM25)</option>
                            <option value="mixed">Mixed (random)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Page Size</label>
                        {field('page_size', 'number', { min: 1, max: 100 })}
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Request Timeout (seconds)</label>
                        {field('request_timeout_seconds', 'number', { min: 5, max: 120 })}
                    </div>

                    <div className="md:col-span-2">
                        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 mt-1">
                            Reranker Config (set on search API via admin)
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Batch Size</label>
                                {field('rerank_batch_size', 'number', { min: 1, max: 32 })}
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Block Size</label>
                                <select
                                    value={config.rerank_block_size}
                                    onChange={(e) => setConfig(c => ({ ...c, rerank_block_size: Number(e.target.value) }))}
                                    disabled={running}
                                    className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                >
                                    {BLOCK_SIZE_OPTIONS.map(v => (
                                        <option key={v} value={v}>{v} tokens</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Recall Size (oversample)</label>
                                {field('recall_size', 'number', { min: 1, max: 200 })}
                            </div>
                        </div>
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Query File (optional — uses default if not provided)</label>
                        <input
                            type="file"
                            accept=".json"
                            onChange={handleFileChange}
                            disabled={running}
                            className="text-sm text-slate-600"
                        />
                        {queryFile
                            ? <p className="text-xs text-green-600 mt-1">{queryFile.name} — valid</p>
                            : !queryFileError && <p className="text-xs text-green-600 mt-1">default_queries.json — valid</p>
                        }
                        {queryFileError && (
                            <p className="text-xs text-red-600 mt-1">{queryFileError}</p>
                        )}
                    </div>
                </div>

                {error && (
                    <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</div>
                )}

                <div className="mt-5 flex gap-3">
                    {!running ? (
                        <button
                            onClick={handleStart}
                            disabled={!!queryFileError}
                            className="bg-blue-600 text-white font-semibold py-2 px-6 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Start Test
                        </button>
                    ) : (
                        <button
                            onClick={handleStop}
                            disabled={stopping}
                            className="bg-red-600 text-white font-semibold py-2 px-6 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                            {stopping ? 'Stopping…' : 'Stop Test'}
                        </button>
                    )}
                    {running && (
                        <span className="self-center text-sm text-slate-500 animate-pulse">
                            Test in progress…
                        </span>
                    )}
                </div>
            </div>

            {/* Live Stats Panel */}
            {(running || snapshot) && (
                <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                    <h2 className="text-lg font-semibold text-slate-800 mb-4">
                        {running ? 'Live Stats' : 'Final Results'}
                        {runId && <span className="text-xs text-slate-400 font-normal ml-2 font-mono">{runId}</span>}
                    </h2>
                    <LiveStats snapshot={snapshot} />
                </div>
            )}

            {/* Historical Runs */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-800">Historical Runs</h2>
                    <button onClick={fetchRuns} className="text-xs text-blue-600 hover:underline">Refresh</button>
                </div>
                {runs.length === 0 ? (
                    <p className="text-sm text-slate-400">No runs yet.</p>
                ) : (
                    <div className="space-y-3">
                        <select
                            value={selectedRunId}
                            onChange={(e) => handleSelectRun(e.target.value)}
                            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                            <option value="">— select a run —</option>
                            {runs.map(r => (
                                <option key={r.id} value={r.id}>
                                    {r.name || r.id.slice(0, 8)} — {r.query_type} — {r.duration_seconds}s — {r.status} — {r.started_at?.slice(0, 16).replace('T', ' ')}
                                </option>
                            ))}
                        </select>

                        {selectedRun && (
                            <div className="mt-4 space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                    {Object.entries(selectedRun.config || {}).map(([k, v]) => (
                                        <div key={k} className="bg-slate-50 rounded p-2">
                                            <span className="text-slate-500">{k}: </span>
                                            <span className="font-mono text-slate-700">{String(v)}</span>
                                        </div>
                                    ))}
                                </div>
                                {selectedRun.aggregate_stats && (
                                    <LiveStats snapshot={selectedRun.aggregate_stats} />
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
