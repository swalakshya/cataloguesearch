import React, { useState } from 'react';
import { Card } from '../JobUI';
import ServiceLogs from './ServiceLogs';
import ServiceConfiguration from './ServiceConfiguration';

export default function ServiceDetails({ service, name = service }) {
    const [tab, setTab] = useState('logs');
    const [revision, setRevision] = useState(0);
    return <Card title={`${name} details`}>
        <div className="flex gap-3 items-center mb-3">
            {['logs', 'config'].map(value => <button key={value} className={`text-sm ${tab === value ? 'font-semibold text-blue-700' : 'text-slate-500'}`} onClick={() => setTab(value)}>
                {value === 'logs' ? 'Logs' : 'Configuration'}
            </button>)}
            <button onClick={() => setRevision(n => n + 1)} className="text-xs text-blue-700">Refresh details</button>
        </div>
        {tab === 'logs' ? <ServiceLogs key={service} service={service} revision={revision} /> : <ServiceConfiguration key={service} service={service} revision={revision} />}
    </Card>;
}
