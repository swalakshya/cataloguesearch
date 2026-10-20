import React, { useState } from 'react';
import { Card } from '../JobUI';

const percent = value => value == null ? '—' : `${value.toFixed(1)}%`;
export default function CoverageView({ data, suite }) {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(null);
    if (!data?.available) return <p role="status" className="text-sm text-slate-500">{data?.reason || 'Coverage is not available yet. It is generated when this suite finishes, including on test failures when possible.'}</p>;
    const files = data.files.filter(f => f.path.toLowerCase().includes(query.toLowerCase()));
    const chosen = data.files.find(f => f.path === selected);
    const missing = new Set(chosen?.missing_lines || []);
    return <div className="space-y-3">
        <Card title={`${suite} source coverage`}>
            <p className="text-sm">Lines: <strong>{percent(data.totals.lines.pct)}</strong> ({data.totals.lines.covered}/{data.totals.lines.total}) · Branches: <strong>{percent(data.totals.branches.pct)}</strong> ({data.totals.branches.covered}/{data.totals.branches.total})</p>
            <p className="text-xs text-slate-500 mt-2">Includes untested sources within the configured scope. Coverage measures this run, including partially completed runs.</p>
            <details className="text-xs mt-2"><summary className="cursor-pointer">Scope & exclusions</summary><pre className="whitespace-pre-wrap">{data.exclusions}</pre></details>
        </Card>
        <input aria-label="Filter source files" placeholder="Find source file…" value={query} onChange={e => setQuery(e.target.value)} className="border rounded p-2 text-sm w-full" />
        <div className="max-h-96 overflow-auto border rounded bg-white"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Source file</th><th>Line coverage</th><th>Missing lines</th></tr></thead><tbody>
            {files.map(f => <tr key={f.path} className={selected === f.path ? 'bg-blue-50' : ''}><td className="p-2"><button className="text-blue-600 text-left break-all" onClick={() => setSelected(f.path)}>{f.path}</button></td><td>{percent(f.lines.total ? 100 * f.lines.covered / f.lines.total : null)}</td><td>{f.missing_lines.length}</td></tr>)}
        </tbody></table></div>
        {chosen && <Card title={chosen.path}>
            <p className="text-xs mb-2 text-slate-500">Source snapshot from this run. Red lines were not covered.</p>
            {data.attribution ? <details className="text-xs mb-2"><summary>Tests that covered this file ({chosen.tests.length})</summary>{chosen.tests.map(t => <div key={t}>{t}</div>)}</details> : <p className="text-xs mb-2 text-slate-500">This runner reports suite coverage; it does not attribute covered lines to individual test files.</p>}
            <div className="max-h-96 overflow-auto bg-slate-950 text-slate-100 font-mono text-xs">{(chosen.source || '').split('\n').map((line, i) => <div key={i} className={`whitespace-pre ${missing.has(i + 1) ? 'bg-red-950 text-red-200' : ''}`}><span className="inline-block w-12 text-right mr-3 text-slate-500 select-none">{i + 1}</span>{line || ' '}</div>)}</div>
        </Card>}
    </div>;
}
