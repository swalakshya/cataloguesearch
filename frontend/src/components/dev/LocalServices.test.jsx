import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LocalServices, { ServiceDetails } from './LocalServices';
import ServiceCard from './services/ServiceCard';

const mocks = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn(), started: vi.fn() }));
vi.mock('./JobUI', async () => ({ ...await vi.importActual('./JobUI'), api: mocks.api, postJson: mocks.post,
    useJobs: () => ({ busy: false, started: mocks.started }), RunPanel: () => null, JobHistory: () => null, BusyNotice: () => null }));
const names = { docker: 'Docker / OrbStack', opensearch: 'OpenSearch', api: 'API', ui: 'Application UI', chat: 'Chat' };
const config = { sources: ['/local/.env.local'], directory: '/local', command: ['python', '-m', 'uvicorn'], note: 'Next start configuration',
    values: [{ key: 'env.JWT_SECRET', value: '••••••••', secret: true }, { key: 'env.PORT', value: '8000', secret: false }] };
beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.mockImplementation(async path => path.endsWith('/config') ? config : path.endsWith('/logs') ? { text: 'Service ready' } : {
        services: ['docker', 'opensearch', 'api', 'ui', 'chat'].map(id => ({ id, name: names[id], status: 'ready', managed: true, update_available: id === 'api',
            impact: id === 'api' ? 'Stop also stops Chat and Application UI.' : '',
            actions: [{ id: 'start', label: 'Start', enabled: false, reason: 'Already running' },
                      { id: 'stop', label: 'Stop', enabled: true }, { id: 'restart', label: 'Restart', enabled: true },
                      ...(id === 'api' ? [{ id: 'update', label: 'Update', enabled: true }] : [])] })),
    });
    mocks.post.mockResolvedValue({ run_id: 'run1', value: 'revealed-secret' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('shows five service controls and starts the dependency-ordered stack through the job API', async () => {
    render(<LocalServices />);
    await screen.findByText('Docker / OrbStack');
    expect(screen.getByText('Update available')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start development' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/local-services/actions', { service: 'all', action: 'start', confirm: false }));
    expect(mocks.started).toHaveBeenCalledWith('run1');
    expect(screen.getByText(/terminate active requests immediately/)).toBeInTheDocument();
});

it('only retrieves secret plaintext after Show and clears it on Hide', async () => {
    render(<ServiceDetails service="api" />);
    fireEvent.click(screen.getByRole('button', { name: 'Configuration' }));
    await screen.findByText('env.JWT_SECRET');
    expect(screen.queryByText('revealed-secret')).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show env.JWT_SECRET' }));
    await screen.findByText('revealed-secret');
    fireEvent.click(screen.getByRole('button', { name: 'Hide env.JWT_SECRET' }));
    expect(screen.queryByText('revealed-secret')).toBeNull();
});

it('hides revealed secrets when switching to logs', async () => {
    render(<ServiceDetails service="chat" />);
    fireEvent.click(screen.getByRole('button', { name: 'Configuration' }));
    await screen.findByText('env.JWT_SECRET');
    fireEvent.click(screen.getByRole('button', { name: 'Show env.JWT_SECRET' }));
    await screen.findByText('revealed-secret');
    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Configuration' }));
    await screen.findByText('env.JWT_SECRET');
    expect(screen.queryByText('revealed-secret')).toBeNull();
});

it('filters configuration by setting name without revealing secrets', async () => {
    render(<ServiceDetails service="api" />);
    fireEvent.click(screen.getByRole('button', { name: 'Configuration' }));
    await screen.findByText('env.JWT_SECRET');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search configuration' }), { target: { value: 'port' } });
    expect(screen.getByText('env.PORT')).toBeInTheDocument();
    expect(screen.queryByText('env.JWT_SECRET')).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
});

it('keeps action errors visible after a successful status refresh', async () => {
    vi.useFakeTimers();
    render(<LocalServices />);
    await act(async () => {});
    mocks.post.mockRejectedValue(new Error('Cannot start service'));
    fireEvent.click(screen.getByRole('button', { name: 'Start development' }));
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot start service');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot start service');
});

it('identifies the selected service and explains dependency impact', async () => {
    render(<LocalServices />);
    const api = await screen.findByRole('button', { name: 'Logs and configuration for API' });
    expect(api).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Logs and configuration for Chat' }));
    expect(api).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Stop also stops Chat and Application UI.')).toBeInTheDocument();
});

it('shows log retrieval time and preserves the last result on refresh failure', async () => {
    mocks.api.mockResolvedValueOnce({ text: 'Last good logs', checked_at: '2026-10-14T12:00:00Z' });
    render(<ServiceDetails service="api" />);
    await screen.findByText('Last good logs');
    expect(screen.getByText(/Last retrieved:/)).toBeInTheDocument();
    mocks.api.mockRejectedValueOnce(new Error('Service unreachable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh details' }));
    await screen.findByText('Service unreachable');
    expect(screen.getByText(/Showing last successful result/)).toBeInTheDocument();
    expect(screen.getByText('Last good logs')).toBeInTheDocument();
});

it('uses action availability and labels supplied by the backend for every service', async () => {
    mocks.api.mockImplementation(async path => path.endsWith('/logs') ? { text: '' } : {
        services: [{ id: 'new-service', name: 'Another service', status: 'failed',
            actions: [{ id: 'start', label: 'Try again', enabled: false, reason: 'Waiting for a dependency' }] }],
    });
    render(<LocalServices />);
    const action = await screen.findByRole('button', { name: 'Try again' });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute('title', 'Waiting for a dependency');
    expect(screen.getByText('Another service')).toBeInTheDocument();
});

it('renders disabled Start controls for ready services', async () => {
    render(<LocalServices />);
    await screen.findByText('Docker / OrbStack');
    const controls = screen.getAllByRole('button', { name: 'Start', exact: true });
    expect(controls).toHaveLength(5);
    controls.forEach(control => expect(control).toBeDisabled());
});


it.each([
    ['ready', 'Ready', 'bg-emerald-700'],
    ['starting', 'Starting', 'bg-orange-200'],
    ['stopped', 'Stopped', 'bg-orange-200'],
    ['unhealthy', 'Not ready', 'bg-red-700'],
    ['failed', 'Failed', 'bg-red-700'],
])('shows a prominent, labeled badge for %s', (status, label, color) => {
    render(<ServiceCard service={{ id: 'api', name: 'API', status, dependencies: ['opensearch'] }} onSelect={vi.fn()} />);
    const badge = screen.getByLabelText(`API: ${label}`);
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveClass(color);
    expect(screen.getByText('Starts with: OpenSearch')).toBeInTheDocument();
});
