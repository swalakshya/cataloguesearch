import React from 'react';
import { Card } from '../JobUI';
import TestStatus, { STATUS_ORDER } from './TestStatus';

export default function SuiteSummary({ suite, files, activeSuite, activeStatus, onFilter, onSetup, runningSuite, runStatus }) {
    const subset = files.filter(f => f.suite === suite.id && f.path !== '__setup__');
    const setup = files.find(f => f.suite === suite.id && f.path === '__setup__');
    const counts = Object.fromEntries(STATUS_ORDER.map(s => [s, subset.filter(f => f.status === s).length]));
    const completed = subset.filter(f => !['pending', 'running', 'blocked'].includes(f.status)).length;
    const blocked = counts.blocked > 0 && completed === 0 && setup?.status === 'failed';
    return <Card title={<button className="capitalize text-left" onClick={() => onFilter(suite.id, 'all')}>{suite.id}</button>} right={<span className="text-xs">{subset.length} files</span>}>
        <p className="text-xs text-slate-500">{suite.environment}</p>
        <div className="flex flex-wrap gap-2 mt-3">{STATUS_ORDER.filter(s => counts[s] > 0).map(s => <TestStatus key={s} status={s} count={counts[s]} onClick={() => onFilter(suite.id, s)} selected={activeSuite === suite.id && activeStatus === s} />)}</div>
        <div className="mt-3 h-1.5 rounded-full overflow-hidden bg-slate-100" role="progressbar" aria-label={`${suite.id} completed files`} aria-valuemin={0} aria-valuemax={subset.length || 1} aria-valuenow={completed}>
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${subset.length ? 100 * completed / subset.length : 0}%` }} />
        </div>
        <p className="text-xs text-slate-500 mt-1">{completed} / {subset.length} files completed</p>
        {setup?.status === 'running' && <div className="mt-3 text-xs text-blue-700 space-y-1">
            <p>{setup.phase || (counts.running ? 'Executing test files and shared fixtures' : 'Preparing tests and shared fixtures; no test file has started yet')}</p>
            {setup.activity && <p className="text-slate-500 break-words line-clamp-2" title={setup.activity}>{setup.activity}</p>}
            <button className="underline" onClick={() => onSetup(setup)}>View live setup logs</button>
        </div>}
        {counts.pending > 0 && setup?.status === 'pending' && runningSuite && runningSuite !== suite.id && <p className="mt-3 text-xs text-slate-500">Waiting for {runningSuite} to finish. Suites run sequentially.</p>}
        {!runStatus && <p className="mt-3 text-xs text-slate-500">Ready to run; tests have not been started.</p>}
        {setup?.status === 'failed' && <button onClick={() => onSetup(setup)} className="mt-3 text-xs text-left text-amber-800 bg-amber-50 rounded px-2 py-1.5 inline-flex items-center gap-1"><span aria-hidden="true">⚠</span>{blocked ? 'Suite blocked' : 'Runner reported an error'} — view setup</button>}
    </Card>;
}
