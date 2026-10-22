import React from 'react';
import { Card } from '../JobUI';
import ServiceActions from './ServiceActions';

const STATES = {
    ready: { label: 'Ready', color: 'bg-emerald-700 text-white' },
    stopped: { label: 'Stopped', color: 'bg-orange-200 text-orange-950' },
    starting: { label: 'Starting', color: 'bg-orange-200 text-orange-950' },
    unhealthy: { label: 'Not ready', color: 'bg-red-700 text-white' },
    failed: { label: 'Failed', color: 'bg-red-700 text-white' },
};
const NAMES = { docker: 'Docker / OrbStack', opensearch: 'OpenSearch', api: 'API', chat: 'Chat', ui: 'Application UI' };

export default function ServiceCard({ service, selected, busy, onAction, onSelect }) {
    const state = STATES[service.status] || { label: 'Unknown', color: 'bg-orange-200 text-orange-950' };
    return <div role="group" aria-label={`${service.name} service`} tabIndex={0}
        onClickCapture={() => onSelect(service.id)}
        onPointerDownCapture={event => { if (event.button === 0) onSelect(service.id); }}
        onKeyDown={event => {
            if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
                event.preventDefault();
                onSelect(service.id);
            }
        }}
        className={`rounded-lg cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${selected ? 'ring-2 ring-blue-500' : ''}`}>
        <Card title={<><span aria-hidden="true" className="mr-2">{service.icon}</span>{service.name}</>} right={<span aria-label={`${service.name}: ${state.label}`} className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-sm font-bold ${state.color}`}>{state.label}</span>}>
            <p className="text-xs text-slate-500 mb-2">{service.port ? `Port ${service.port}` : 'Local container runtime'}{service.external ? ' · Started externally' : ''}</p>
            {service.dependencies?.length > 0 && <p className="text-xs text-slate-600 mb-2">Starts with: {service.dependencies.map(id => NAMES[id] || id).join(', ')}</p>}
            {service.message && <p className="text-xs text-slate-500 break-words mb-2">{service.message}</p>}
            {service.update_available && <p className="text-xs font-semibold text-orange-700 mb-2">Update available</p>}
            {service.impact && <p className="text-xs text-slate-500 mb-2">{service.impact}</p>}
            <ServiceActions service={service} busy={busy} onAction={onAction} />
            <button aria-pressed={selected} aria-label={`Logs and configuration for ${service.name}`} className="text-xs text-blue-700 mt-2">Logs & config</button>
        </Card>
    </div>;
}
