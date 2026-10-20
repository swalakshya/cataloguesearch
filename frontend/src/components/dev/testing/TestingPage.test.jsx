import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import TestingPage from './TestingPage';
import CoverageView from './CoverageView';
const mocks = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn(), jobs: {} }));
vi.mock('../JobUI', async () => {
    const actual = await vi.importActual('../JobUI');
    return { ...actual, api: mocks.api, postJson: mocks.post, useJobs: () => mocks.jobs, JobHistory: () => <details><summary>History</summary></details> };
});
vi.mock('./TestFileDetails', () => ({ default: ({ file }) => <div>Selected logs: {file.path}</div> }));
const files = [
    { id: 'a', suite: 'python', path: 'tests/test_a.py', status: 'failed', counts: { passed: 1, failed: 1 }, duration: 1 },
    { id: 'b', suite: 'frontend', path: 'src/b.test.jsx', status: 'pending', counts: {}, duration: 0 },
];
beforeEach(() => {
    mocks.api.mockReset(); mocks.post.mockReset();
    mocks.jobs = { selectedRunId: 'abc', selectedRun: { status: 'failed', label: 'Tests' }, busy: false, activeHere: false, setError: vi.fn(), started: vi.fn() };
    mocks.api.mockImplementation(path => Promise.resolve(path === '/testing' ? { files, requirements: [], suites: [{ id: 'python', count: 1, available: true, environment: 'tests/.env' }] } : { files }));
    mocks.post.mockResolvedValue({ run_id: 'new' });
});
it('selects per-file logs and submits all three suites without launching one process per file', async () => {
    render(<TestingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /tests\/test_a.py/ }));
    expect(screen.getByText('Selected logs: tests/test_a.py')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run all tests' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/testing/runs', { suites: ['python', 'frontend', 'chat'] }));
    expect(mocks.jobs.started).toHaveBeenCalledWith('new');
    expect(screen.getByText('History').parentElement).not.toHaveAttribute('open');
});
it('shows uncovered source lines and clearly separates suite coverage from test attribution', () => {
    render(<CoverageView suite="frontend" data={{ available: true, totals: { lines: { pct: 25, covered: 1, total: 4 }, branches: { pct: null, total: 0, covered: 0 } }, files: [{ path: 'src/example.js', lines: { total: 4, covered: 1 }, missing_lines: [2], source: 'covered\nmissing', tests: [] }] }} />);
    expect(screen.getAllByText('25.0%')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'src/example.js' }));
    expect(screen.getByText('missing')).toHaveClass('bg-red-950');
    expect(screen.getByText(/does not attribute/)).toBeInTheDocument();
});
