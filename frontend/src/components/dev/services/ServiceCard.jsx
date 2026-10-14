import React from 'react';
import { Card } from '../JobUI';
import ServiceActions from './ServiceActions';

const COLORS = { ready: 'text-green-700', stopped: 'text-slate-500', starting: 'text-orange-700', unhealthy: 'text-red-700', failed: 'text-red-700' };

export default function ServiceCard({ service, selected, busy, onAction, onSelect }) {
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
        <Card title={<><span aria-hidden="true" className="mr-2">{service.icon}</span>{service.name}</>} right={<span className={`text-xs font-medium ${COLORS[service.status] || 'text-slate-500'}`}>{service.status}</span>}>
            <p className="text-xs text-slate-500 mb-2">{service.port ? `Port ${service.port}` : 'Local container runtime'}{service.external ? ' · Started externally' : ''}</p>
            {service.message && <p className="text-xs text-slate-500 break-words mb-2">{service.message}</p>}
            {service.update_available && <p className="text-xs font-semibold text-orange-700 mb-2">Update available</p>}
            {service.impact && <p className="text-xs text-slate-500 mb-2">{service.impact}</p>}
            <ServiceActions service={service} busy={busy} onAction={onAction} />
            <button aria-pressed={selected} aria-label={`Logs and configuration for ${service.name}`} className="text-xs text-blue-700 mt-2">Logs & config</button>
        </Card>
    </div>;
}
