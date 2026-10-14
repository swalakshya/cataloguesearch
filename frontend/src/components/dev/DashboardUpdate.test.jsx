import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DashboardUpdate from './DashboardUpdate';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('./JobUI', () => ({ api: mocks.api }));
beforeEach(() => { vi.useFakeTimers(); mocks.api.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const response = overrides => ({ enabled: true, available: true, instance: 'one', phase: 'idle', ...overrides });

it('detects changes but only requests an update after a click', async () => {
    mocks.api.mockResolvedValue(response());
    render(<DashboardUpdate />);
    await act(async () => {});
    expect(mocks.api.mock.calls.every(([path]) => path === '/dashboard/status')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Update available' }));
    await act(async () => {});
    expect(mocks.api).toHaveBeenCalledWith('/dashboard/update', { method: 'POST' });
});

it('shows waiting for jobs and prevents duplicate requests', async () => {
    mocks.api.mockResolvedValue(response({ phase: 'waiting' }));
    render(<DashboardUpdate />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Update queued · waiting for jobs' })).toBeDisabled();
});

it('shows a failed build and permits retry', async () => {
    mocks.api.mockResolvedValue(response({ phase: 'error', message: 'Node/npm is missing' }));
    render(<DashboardUpdate />);
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('Node/npm is missing');
    expect(screen.getByRole('button', { name: 'Update available' })).toBeEnabled();
});

it('stays hidden on the legacy frontend or when up to date', async () => {
    mocks.api.mockResolvedValue({ enabled: false });
    const { unmount } = render(<DashboardUpdate />);
    await act(async () => {});
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    mocks.api.mockResolvedValue(response({ available: false }));
    render(<DashboardUpdate />);
    await act(async () => {});
    expect(screen.queryByRole('button')).toBeNull();
});
