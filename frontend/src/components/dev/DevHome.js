import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Card, StatusBadge } from './JobUI';

const EVAL_TOOLS = [
    { tab: 'pdf-parser', name: 'PDF Parser', desc: 'OCR a PDF page and inspect blocks and lines' },
    { tab: 'ocr-preview', name: 'OCR Preview', desc: 'Preview OCR output for a file' },
    { tab: 'paragraph-eval', name: 'Paragraph Gen Eval', desc: 'Judge paragraph generation quality' },
    { tab: 'paragraph-classifier', name: 'Paragraph Classifier', desc: 'Label paragraph block types' },
    { tab: 'unindexed-pdfs', name: 'Unindexed PDFs', desc: 'Older view with stale detection' },
    { tab: 'bookmark-backfill', name: 'Bookmark Backfill', desc: 'Extract and save LLM bookmarks' },
    { tab: 'load-test', name: 'Load Test', desc: 'Load-test the search API' },
];

function BigLink({ to, title, desc, children }) {
    return (
        <Link
            to={to}
            className="block bg-white border border-slate-200 rounded-lg p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition cursor-pointer"
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-base font-semibold text-slate-800">{title}</div>
                    <div className="text-sm text-slate-500 mt-1">{desc}</div>
                </div>
                <span className="text-slate-300 text-lg">→</span>
            </div>
            {children && <div className="mt-3">{children}</div>}
        </Link>
    );
}

export default function DevHome() {
    const [pending, setPending] = useState(null);
    const [active, setActive] = useState(null);
    const [offline, setOffline] = useState(false);

    useEffect(() => {
        api('/jobs/runs?limit=1').then((d) => {
            setActive(d.runs.find((r) => r.id === d.active_run_id) || (d.active_run_id ? { label: 'another job' } : null));
        }).catch(() => setOffline(true));
        api('/discover/status').then((d) => setPending(d.totals.pending)).catch(() => {});
    }, []);

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
                <div>
                    <h1 className="text-xl font-semibold text-slate-800">Dev</h1>
                    <p className="text-xs text-slate-500">Local tools: ingest, deploy and evaluation. Served by the dev server on this machine.</p>
                </div>

                {offline && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3">
                        The dev server isn't reachable. Start it with <code className="font-mono">uvicorn dev:app --host 127.0.0.1 --port 8001</code>.
                    </div>
                )}
                {active && (
                    <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded p-3 flex items-center gap-2">
                        <StatusBadge status="running" />
                        <span>A job is running: {active.label}. Only one job runs at a time.</span>
                    </div>
                )}

                <div className="grid md:grid-cols-2 gap-4">
                    <BigLink to="/discover" title="Discover" desc="Crawl and index PDFs that aren't in OpenSearch yet. Waits for LLM batch jobs on its own.">
                        {pending !== null && (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${pending > 0 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                {pending > 0 ? `${pending} file${pending === 1 ? '' : 's'} to ingest` : 'everything indexed'}
                            </span>
                        )}
                    </BigLink>
                    <BigLink to="/deploy" title="Deploy" desc="Build and push images, copy snapshots to prod, restore and restart services." />
                </div>

                <Card title="Eval tools" right={<Link to="/eval" className="text-xs text-blue-600 hover:underline">open Eval home</Link>}>
                    <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {EVAL_TOOLS.map((t) => (
                            <Link
                                key={t.tab}
                                to={`/eval?tab=${t.tab}`}
                                className="block border border-slate-200 rounded-md p-3 hover:border-blue-300 hover:bg-blue-50/30 transition cursor-pointer"
                            >
                                <div className="text-sm font-medium text-slate-800">{t.name}</div>
                                <div className="text-xs text-slate-500 mt-0.5">{t.desc}</div>
                            </Link>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
}
