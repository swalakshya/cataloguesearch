import React from 'react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import DeployPage from './DeployPage';

const mocks = vi.hoisted(() => ({ api: vi.fn(), postJson: vi.fn(), started: vi.fn(), blocked: false }));
vi.mock('../dev/JobUI', async () => ({ ...(await vi.importActual('../dev/JobUI')),
    api: mocks.api, postJson: mocks.postJson,
    useJobs: () => ({ busy: false, error: '', setError: () => {}, started: mocks.started }),
    RunPanel: () => null, JobHistory: () => null, BusyNotice: () => null,
}));
vi.mock('../dev/DevShell', () => ({ useDevShell: () => ({ docker: { blocked: mocks.blocked } }), DockerBlockedNotice: () => null }));
vi.mock('./OpenSearchCompare', () => ({ default: () => null, useOpenSearchCompare: () => ({ report: null, refresh: () => {} }) }));
vi.mock('./CleanupTab', () => ({ default: () => null }));

beforeEach(() => {
    vi.clearAllMocks(); mocks.blocked = false;
    mocks.api.mockImplementation(async path => path === '/deploy/config' ? {
        build_services: ['cataloguesearch-api', 'cataloguesearch-frontend', 'cataloguesearch-chat'],
        default_build_services: ['cataloguesearch-api'], prod_host: 'test-prod', actions: [],
    } : null);
    mocks.postJson.mockResolvedValue({ run_id: 'run' });
});
afterEach(cleanup);
async function setup() {
    render(<MemoryRouter><DeployPage /></MemoryRouter>);
    await screen.findByRole('checkbox', { name: 'cataloguesearch-api' });
    return screen.getByRole('heading', { name: '1. Service images' }).closest('.bg-white');
}
async function confirmRun() {
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'prod' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run', exact: true }));
    await waitFor(() => expect(mocks.postJson).toHaveBeenCalled());
}

it('builds only by default using selected services', async () => {
    const card = await setup();
    fireEvent.click(within(card).getByRole('button', { name: 'Run', exact: true }));
    await waitFor(() => expect(mocks.postJson).toHaveBeenCalledWith('/deploy/runs', { actions: ['build'], build_services: ['cataloguesearch-api'] }));
});
it('pulls and restarts only chat even when local Docker is blocked', async () => {
    mocks.blocked = true;
    const card = await setup();
    for (const name of ['Build & Push', 'Pull & Restart Services', 'cataloguesearch-api', 'cataloguesearch-chat']) {
        fireEvent.click(within(card).getByRole('checkbox', { name }));
    }
    fireEvent.click(within(card).getByRole('button', { name: 'Run', exact: true }));
    expect(mocks.postJson).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('cataloguesearch-chat');
    await confirmRun();
    expect(mocks.postJson).toHaveBeenCalledWith('/deploy/runs', { actions: ['pull_restart'], build_services: ['cataloguesearch-chat'] });
});
it('runs both actions in order and disables Run for empty selections', async () => {
    const card = await setup();
    const run = within(card).getByRole('button', { name: 'Run', exact: true });
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Build & Push' }));
    expect(run).toBeDisabled();
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Build & Push' }));
    fireEvent.click(within(card).getByRole('checkbox', { name: 'cataloguesearch-api' }));
    expect(run).toBeDisabled();
    fireEvent.click(within(card).getByRole('checkbox', { name: 'cataloguesearch-api' }));
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Pull & Restart Services' }));
    fireEvent.click(run);
    await confirmRun();
    expect(mocks.postJson).toHaveBeenCalledWith('/deploy/runs', { actions: ['build', 'pull_restart'], build_services: ['cataloguesearch-api'] });
});
