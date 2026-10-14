import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import ProductionLogs from './ProductionLogs';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../dev/JobUI', async () => ({ ...await vi.importActual('../dev/JobUI'), api: mocks.api }));
const result = { reachable: true, text: 'message_failed: DNS unavailable', truncated: false, checked_at: '2026-10-13T17:00:00Z' };
beforeEach(() => { mocks.api.mockReset(); mocks.api.mockResolvedValue(result); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('opens chat logs by default and can select a different service and time range', async () => {
    render(<ProductionLogs />);
    await screen.findByText(result.text);
    expect(mocks.api.mock.calls[0][0]).toBe('/deploy/production/logs?service=chat&lines=10000&since=15m');
    mocks.api.mockResolvedValue({ ...result, text: 'API ready' });
    fireEvent.change(screen.getByLabelText('Log service'), { target: { value: 'api' } });
    expect(await screen.findByText('API ready')).toBeInTheDocument();
    expect(screen.queryByText(result.text)).toBeNull();
    fireEvent.change(screen.getByLabelText('Log time range'), { target: { value: '1h' } });
    await waitFor(() => expect(mocks.api.mock.lastCall[0]).toContain('since=1h'));
});

it('keeps previous output and labels a failed refresh', async () => {
    render(<ProductionLogs />);
    await screen.findByText(result.text);
    mocks.api.mockResolvedValue({ reachable: false, error: 'SSH unavailable' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh logs' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('SSH unavailable');
    expect(screen.getByText(result.text)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Showing last successful result');
});

it('shows empty and truncated output explicitly', async () => {
    mocks.api.mockResolvedValue({ ...result, text: '', truncated: true });
    render(<ProductionLogs />);
    expect(await screen.findByText('No logs in this time range.')).toBeInTheDocument();
    expect(screen.getByText(/History limit reached/)).toBeInTheDocument();
});

it('polls automatically and stops on unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<ProductionLogs />);
    await act(async () => {});
    expect(mocks.api).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.api).toHaveBeenCalledTimes(3);
    expect(screen.queryByLabelText('Live updates')).toBeNull();
    unmount();
    const stopped = mocks.api.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.api).toHaveBeenCalledTimes(stopped);
});
