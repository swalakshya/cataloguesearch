import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { LogViewer } from './JobUI';
import { copyToClipboard } from '../../utils/shareUtils';

vi.mock('../../utils/shareUtils', () => ({ copyToClipboard: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('copies the complete accumulated log, preserving newlines and Unicode', async () => {
    const parts = ['पहला output\n', 'second output\n'];
    let index = 0;
    fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ text: parts[index++] || '', offset: index * 20 }) }));
    copyToClipboard.mockResolvedValue(true);
    render(<LogViewer runId="run" step="build" running={false} />);
    await screen.findByText(/second output/);
    fireEvent.click(screen.getByRole('button', { name: 'Copy terminal output' }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(parts.join('')));
    await screen.findByRole('button', { name: 'Copied!' });
});

it('does not copy the placeholder when there is no output', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ text: '', offset: 0 }) });
    render(<LogViewer runId="run" step="build" running={false} />);
    expect(screen.getByRole('button', { name: 'Copy terminal output' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Copy terminal output' }));
    expect(copyToClipboard).not.toHaveBeenCalled();
});

it('reports a failed clipboard operation without claiming success', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ text: 'output\n', offset: 7 }) });
    copyToClipboard.mockResolvedValue(false);
    render(<LogViewer runId="run" step="build" running={true} />);
    await screen.findByText('output');
    fireEvent.click(screen.getByRole('button', { name: 'Copy terminal output' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
});
