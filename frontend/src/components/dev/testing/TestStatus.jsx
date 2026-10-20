import React from 'react';
import { CheckCircle2, XCircle, Clock, Loader2, MinusCircle, PauseCircle, Square, AlertTriangle } from 'lucide-react';

export const FILE_STATUSES = {
    running: 'Running', pending: 'Queued', blocked: 'Blocked', failed: 'Failed',
    interrupted: 'Interrupted', cancelled: 'Cancelled', succeeded: 'Passed', skipped: 'Skipped',
};
export const STATUS_ORDER = Object.keys(FILE_STATUSES);
const STYLES = {
    running: [Loader2, 'bg-blue-50 text-blue-700 ring-blue-200'],
    pending: [Clock, 'bg-slate-100 text-slate-600 ring-slate-200'],
    blocked: [AlertTriangle, 'bg-amber-50 text-amber-800 ring-amber-200'],
    failed: [XCircle, 'bg-red-50 text-red-700 ring-red-200'],
    interrupted: [PauseCircle, 'bg-amber-50 text-amber-800 ring-amber-200'],
    cancelled: [Square, 'bg-amber-50 text-amber-800 ring-amber-200'],
    succeeded: [CheckCircle2, 'bg-green-50 text-green-700 ring-green-200'],
    skipped: [MinusCircle, 'bg-slate-50 text-slate-500 ring-slate-200'],
};
export default function TestStatus({ status, count, onClick, selected = false }) {
    const [Icon, colors] = STYLES[status] || STYLES.pending;
    const props = { className: `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${colors} ${selected ? 'outline outline-2 outline-offset-2 outline-blue-500' : ''}` };
    const contents = <><Icon aria-hidden="true" size={14} className={status === 'running' ? 'animate-spin' : ''} /><span>{FILE_STATUSES[status] || status}{count != null ? ` ${count}` : ''}</span></>;
    return onClick ? <button type="button" {...props} onClick={onClick} aria-pressed={selected}>{contents}</button> : <span {...props}>{contents}</span>;
}
