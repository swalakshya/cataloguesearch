import React from 'react';

export default function ServiceActions({ service, busy, onAction }) {
    return <div className="flex flex-wrap gap-2 text-xs">
        {(service.actions || []).map(action => <button key={action.id}
            disabled={busy || !action.enabled} title={action.reason || undefined}
            onClick={() => onAction(service.id, action)}
            className={`border rounded px-2 py-1 disabled:opacity-30 ${action.id === 'update' ? 'border-orange-400 text-orange-700' : 'border-slate-300'}`}>
            {action.label}
        </button>)}
    </div>;
}
