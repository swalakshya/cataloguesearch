import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { LogViewer, RunPanel, useJobs } from './JobUI';
const response = body => ({ ok: true, json: async () => body });
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('prevents overlapping requests and ignores responses from a previous kind', async () => {
    let resolveOld;
    fetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
        .mockResolvedValue(response({ runs: [{ id: 'new', steps: [] }], active_run_id: null }));
    const { result, rerender } = renderHook(({ kind }) => useJobs(kind), { initialProps: { kind: 'backup' } });
    await act(async () => { await result.current.reload(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].cache).toBe('no-store');
    rerender({ kind: 'deploy' });
    await flush();
    await act(async () => resolveOld(response({ runs: [{ id: 'old', steps: [] }], active_run_id: null })));
    expect(result.current.runs).toEqual([{ id: 'new', steps: [] }]);
});
it('times out a stuck read and recovers on the next poll', async () => {
    fetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })).mockResolvedValue(response({ runs: [], active_run_id: null }));
    const { result } = renderHook(() => useJobs('backup'));
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(result.current.pollError).toContain('timed out');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(result.current.pollError).toBe('');
    expect(result.current.lastUpdated).not.toBeNull();
});
it('refreshes immediately when the window regains focus', async () => {
    fetch.mockResolvedValue(response({ runs: [], active_run_id: null }));
    renderHook(() => useJobs('backup'));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.focus(window);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
});
it('shows log failures and preserves output when retries recover', async () => {
    fetch.mockResolvedValueOnce(response({ text: 'Uploading…\n', offset: 12 }))
        .mockRejectedValueOnce(new Error('Tunnel disconnected'))
        .mockResolvedValue(response({ text: '50%\n', offset: 16 }));
    render(<LogViewer runId="backup" step="upload" running />);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Tunnel disconnected');
    expect(screen.getByText(/Uploading…/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry logs' }));
    await flush();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/Uploading…\s+50%/)).toBeInTheDocument();
    expect(fetch.mock.calls[2][0]).toContain('offset=12');
});
it('labels stale status and offers a refresh', () => {
    const reload = vi.fn();
    const jobs = { selectedRun: { id: 'backup', status: 'running', steps: [] }, selectedStep: null,
        nowMs: 20000, lastUpdated: 5000, pollError: '', reload };
    render(<RunPanel jobs={jobs} />);
    expect(screen.getByRole('status')).toHaveTextContent('progress may be outdated');
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(reload).toHaveBeenCalledOnce();
});
