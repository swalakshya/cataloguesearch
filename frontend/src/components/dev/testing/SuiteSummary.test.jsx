import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SuiteSummary from './SuiteSummary';
const suite = { id: 'python', environment: 'tests/.env' };
const file = (status, id) => ({ suite: 'python', path: `${id}.py`, id, status });
it('shows nonzero status pills in priority order and filters by suite and status', () => {
    const filter = vi.fn();
    render(<SuiteSummary suite={suite} files={[file('succeeded', 'a'), file('running', 'b'), file('pending', 'c'), file('failed', 'd')]} onFilter={filter} onSetup={vi.fn()} activeSuite="python" activeStatus="failed" />);
    const buttons = screen.getAllByRole('button').map(b => b.textContent);
    expect(buttons).toEqual(['python', 'Running 1', 'Queued 1', 'Failed 1', 'Passed 1']);
    expect(screen.queryByText(/Skipped/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Failed 1' }));
    expect(filter).toHaveBeenCalledWith('python', 'failed');
    expect(screen.getByRole('button', { name: 'Failed 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
});
it('distinguishes blocked setup from deliberate skips and opens setup details', () => {
    const onSetup = vi.fn();
    const setup = { suite: 'python', path: '__setup__', id: 'setup', status: 'failed' };
    render(<SuiteSummary suite={suite} files={[file('blocked', 'a'), setup]} onFilter={vi.fn()} onSetup={onSetup} />);
    expect(screen.getByRole('button', { name: 'Blocked 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Suite blocked/ }));
    expect(onSetup).toHaveBeenCalledWith(setup);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
});
it('explains setup activity and why a later suite is queued', () => {
    const setup = { suite: 'python', id: 'setup', path: '__setup__', status: 'running', phase: 'Waiting for test OpenSearch', activity: 'Starting container' };
    const onSetup = vi.fn();
    const { rerender } = render(<SuiteSummary suite={suite} files={[file('pending', 'a'), setup]} runningSuite="python" runStatus="running" onFilter={vi.fn()} onSetup={onSetup} />);
    expect(screen.getByText('Waiting for test OpenSearch')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View live setup logs' }));
    expect(onSetup).toHaveBeenCalledWith(setup);
    rerender(<SuiteSummary suite={{ id: 'frontend' }} files={[{ suite: 'frontend', path: 'a.test.js', status: 'pending' }, { suite: 'frontend', path: '__setup__', status: 'pending' }]} runningSuite="python" runStatus="running" onFilter={vi.fn()} onSetup={vi.fn()} />);
    expect(screen.getByText('Waiting for python to finish. Suites run sequentially.')).toBeInTheDocument();
});
