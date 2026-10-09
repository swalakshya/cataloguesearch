import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import BackupsTab from './BackupsTab';

const mocks = vi.hoisted(() => ({ api: vi.fn(), postJson: vi.fn(), started: vi.fn() }));
vi.mock('../dev/JobUI', async () => ({ ...(await vi.importActual('../dev/JobUI')),
    api: mocks.api, postJson: mocks.postJson,
    useJobs: () => ({ busy: false, error: '', setError: () => {}, started: mocks.started }),
    RunPanel: () => null, JobHistory: () => null, BusyNotice: () => null,
}));
vi.mock('../dev/DevShell', () => ({ useDevShell: () => ({ docker: { blocked: false } }) }));
const base = { rclone_available: true, connected: true, source_exists: true, date: '20261009',
    source: '/home/user/cataloguesearch', destination: 'My Drive/snapshots', keep_latest: 2, connection_state: 'idle' };
function mockStatus(overrides={}) {
    mocks.api.mockImplementation(async path => path.endsWith('/status') ? { ...base, ...overrides } : {
        folders: ['20260925', '20260919'], remove_after_upload: ['20260919'],
    });
}
beforeEach(() => { vi.clearAllMocks(); mockStatus(); mocks.postJson.mockResolvedValue({ run_id: 'run' }); vi.spyOn(window, 'open').mockReturnValue(null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('disables submission and shows an error when rclone is missing', async () => {
    mockStatus({ rclone_available: false, connected: false, error: 'rclone is not installed.' });
    render(<BackupsTab />);
    await screen.findByText('rclone is not installed.');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect Google Drive' })).toBeDisabled();
    expect(mocks.postJson).not.toHaveBeenCalled();
});
it('previews retention of two dated folders and starts the backend backup', async () => {
    render(<BackupsTab />);
    await screen.findByText('20260919');
    expect(screen.getByText('cataloguesearch_20261009.tar.zst')).toBeInTheDocument();
    expect(screen.getByText('snapshots_20261009.tar.zst')).toBeInTheDocument();
    const submit=screen.getByRole('button', { name: 'Submit' });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.postJson).toHaveBeenCalledWith('/deploy/backups/runs', {}));
    expect(mocks.started).toHaveBeenCalledWith('run');
});
it('connects through the backend and provides the Google sign-in link before enabling Submit', async () => {
    mockStatus({ connected: false });
    mocks.postJson.mockResolvedValue({ ...base, connected: false, connection_state: 'connecting', auth_url: 'http://127.0.0.1:53682/auth?state=test' });
    render(<BackupsTab />);
    await screen.findByText('Google Drive is not connected.');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Google Drive' }));
    await waitFor(() => expect(mocks.postJson).toHaveBeenCalledWith('/deploy/backups/connect', {}));
    expect(await screen.findByRole('link', { name: 'Open Google sign-in' })).toHaveAttribute('href', 'http://127.0.0.1:53682/auth?state=test');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
});

it('shows preparation status while the start request is pending', async () => {
    mocks.postJson.mockReturnValue(new Promise(() => {}));
    render(<BackupsTab />);
    const submit = await screen.findByRole('button', { name: 'Submit' });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    expect(screen.getByRole('status')).toHaveTextContent('Preparing backup job');
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
});
