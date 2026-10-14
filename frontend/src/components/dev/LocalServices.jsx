import React, { useState } from 'react';
import { PageShell, useJobs, RunPanel, JobHistory, BusyNotice } from './JobUI';
import ServiceCard from './services/ServiceCard';
import ServiceDetails from './services/ServiceDetails';
import useServicePolling from './services/useServicePolling';
import useServiceActions from './services/useServiceActions';

export { default as ServiceDetails } from './services/ServiceDetails';

export default function LocalServices() {
    const [selected, setSelected] = useState('api');
    const { data: report, error: pollError, refresh } = useServicePolling('/local-services', { interval: 5000 });
    const jobs = useJobs('services', refresh);
    const { perform, error, busy } = useServiceActions(jobs, refresh);
    const selectedService = report?.services.find(service => service.id === selected);
    return <PageShell title="Local services" subtitle="Your laptop · local source and configuration only">
        <div className="flex flex-wrap gap-3 items-center">
            <button disabled={busy} onClick={() => perform('all', { id: 'start' })} className="bg-blue-600 text-white rounded px-4 py-2 text-sm disabled:opacity-40">Start development</button>
            <button disabled={busy} onClick={() => perform('all', { id: 'stop' })} className="border rounded px-4 py-2 text-sm disabled:opacity-40">Stop development</button>
            <a href="http://localhost:3000" target="_blank" rel="noreferrer" className="text-sm text-blue-700">Open application ↗</a>
        </div>
        <p className="text-xs text-slate-500">Stop development preserves Docker and stored data. Restart and Update terminate active requests immediately. Dependencies start first; stopping a dependency also stops its managed dependents.</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {pollError && <p role="alert" className="text-sm text-orange-700">Status refresh failed: {pollError}. Showing the last known status.</p>}
        <BusyNotice jobs={jobs} />
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{report?.services.map(service => <ServiceCard key={service.id} service={service}
            selected={selected === service.id} busy={busy} onAction={perform} onSelect={setSelected} />)}</div>
        {!report && !pollError && <p className="text-sm text-slate-500">Checking local services…</p>}
        <RunPanel jobs={jobs} />
        <ServiceDetails key={selected} service={selected} name={selectedService?.name} />
        <JobHistory jobs={jobs} />
    </PageShell>;
}
