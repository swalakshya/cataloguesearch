import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProductionPage from './ProductionPage';

const mocks = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn(), started: vi.fn(), setError: vi.fn() }));
vi.mock('./JobUI', async () => ({ ...await vi.importActual('./JobUI'), api: mocks.api, postJson: mocks.post,
    useJobs: () => ({ busy: false, started: mocks.started, setError: mocks.setError }),
    BusyNotice: () => null, RunPanel: () => null, JobHistory: () => null }));
vi.mock('../deploy/ProductionLogs', () => ({ default: () => <p>Service logs</p> }));
const report = { reachable: true, host: 'prod', system: { ubuntu: 'Ubuntu 26.04', kernel: '7.0', reboot_required: false },
    resources: { cpu_percent: 25, cpu_count: 2, memory_total: 1000, memory_used: 500, disk_total: 10000, disk_used: 1000, uptime_seconds: 7200 },
    updates: { pending: 0, security: 0 }, containers: [{ name: 'cataloguesearch-api', image: 'example:api', image_id: 'sha256:deployed', status: 'Up (healthy)' }],
    snapshots: { repositories: [{ name: 'backup', snapshots: [{ snapshot: 'snapshot-1', state: 'SUCCESS', indices: ['catalogue'] }] }] } };
beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.mockImplementation(async path => path.startsWith('/deploy/production') ? report : path === '/deploy/config' ? {
        build_services: ['cataloguesearch-api', 'cataloguesearch-chat'], default_build_services: ['cataloguesearch-api'], prod_host: 'prod',
    } : { runs: [] });
    mocks.post.mockResolvedValue({ run_id: 'run' });
});
afterEach(cleanup);
const show = section => render(<MemoryRouter><ProductionPage section={section} /></MemoryRouter>);

it('shows read-only resource usage and deployed image identity', async () => {
    show('overview');
    await screen.findByText('25%');
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.getByText('10.0%')).toBeInTheDocument();
    expect(screen.getByText('sha256:deployed')).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
});

it('requires typed production confirmation before restarting selected services', async () => {
    show('services');
    const restart = await screen.findByRole('button', { name: 'Restart services' });
    await waitFor(() => expect(restart).toBeEnabled());
    fireEvent.click(restart);
    expect(mocks.post).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'prod' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run', exact: true }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/deploy/runs', { actions: ['restart_services'], build_services: ['cataloguesearch-api'] }));
});

it('shows snapshots and requires confirmation before restoring staged files', async () => {
    show('backups');
    await screen.findByText('snapshot-1 · SUCCESS');
    fireEvent.click(screen.getByRole('button', { name: 'Restore staged snapshots…' }));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('indices are deleted');
});
