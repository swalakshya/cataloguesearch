import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProductionTab from './ProductionTab';
vi.mock('./ProductionLogs', () => ({ default: () => null }));

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../dev/JobUI', async () => ({ ...await vi.importActual('../dev/JobUI'), api: mocks.api,
    useJobs: () => ({ busy: false, started: () => {} }), RunPanel: () => null, JobHistory: () => null, BusyNotice: () => null }));
vi.mock('../dev/DevShell', () => ({ useDevShell: () => ({}) }));
const report = {
    reachable: true, host: 'prod', checked_at: '2026-10-13T16:00:00Z',
    system: { ubuntu: 'Ubuntu 24.04.4 LTS', reboot_required: false },
    updates: { pending: 247, security: 181, source: 'Cached apt package lists; no update was run' },
    certificates: [{ name: 'swalakshya.me-0001', domains: ['swalakshya.me'], expires_at: '2026-10-22T00:40:15Z', days_remaining: 8 }],
    endpoints: [{ domain: 'swalakshya.me', valid: true, matches_disk: false, expires_at: '2026-10-22T00:40:15Z', days_remaining: 8 }],
    renewal: { timer: { ActiveState: 'active', UnitFileState: 'enabled' }, service: { Result: 'exit-code' },
        methods: [{ name: 'swalakshya.me-0001', authenticator: 'standalone' }], recent_log: 'Could not bind TCP port 80' },
};
beforeEach(() => { vi.clearAllMocks(); mocks.api.mockResolvedValue(report); });
afterEach(cleanup);

it('warns about failed renewal even when HTTPS is valid, and detects missed reloads', async () => {
    render(<ProductionTab />);
    expect(await screen.findByText(/Automatic certificate renewal failed/)).toBeInTheDocument();
    expect(screen.getByText('Certificate valid')).toBeInTheDocument();
    expect(screen.getByText(/Served certificate differs from disk/)).toBeInTheDocument();
    expect(screen.getByText(/8 full days remaining · Expires/)).toHaveClass('text-red-700');
    expect(screen.getByText('Ubuntu 24.04.4 LTS')).toBeInTheDocument();
    expect(screen.getByText(/247 packages · 181/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh production' }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenCalledWith('/deploy/production?fresh=true');
});

it('handles SSH failure without rendering healthy status', async () => {
    mocks.api.mockResolvedValue({ reachable: false, error: 'Permission denied' });
    render(<ProductionTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
    expect(screen.queryByText('Certificate valid')).not.toBeInTheDocument();
});

it('preserves independent results when certificate and renewal access fails', async () => {
    mocks.api.mockResolvedValue({ ...report, certificates: { error: 'Certificate access denied' }, renewal: { error: 'Renewal access denied' } });
    render(<ProductionTab />);
    expect(await screen.findByText('Certificate access denied')).toBeInTheDocument();
    expect(screen.getByText('Renewal access denied')).toBeInTheDocument();
    expect(screen.getByText('Ubuntu 24.04.4 LTS')).toBeInTheDocument();
});

it('labels previous results when a refresh fails', async () => {
    render(<ProductionTab />);
    await screen.findByText('Ubuntu 24.04.4 LTS');
    mocks.api.mockRejectedValue(new Error('Dev server offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh production' }));
    expect(await screen.findByText(/Could not refresh production: Dev server offline/)).toBeInTheDocument();
    expect(screen.getByText(/Previous results/)).toBeInTheDocument();
});
