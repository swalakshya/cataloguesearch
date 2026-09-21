import React from 'react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import DeployPage from './DeployPage';
import { COMPARE_EVERY_MS } from './OpenSearchCompare';

const idx = (name, extra = {}) => ({
    name, dev: { exists: true, docs: 10, bytes: 1e6 }, prod: { exists: true, docs: 10, bytes: 1e6 }, in_sync: true,
    diff: { missing_on_prod: { total: 0, items: [] }, only_on_prod: { total: 0, items: [] }, changed: { total: 0, items: [] } }, ...extra,
});
const GREEN = { in_sync: true, differing: [], indices: [idx('cataloguesearch_prod')] };
const bad = idx('cataloguesearch_prod', { in_sync: false });
bad.diff.missing_on_prod = { total: 1, items: [{ document_id: 'd1', name: 'New Granth', chunks: 42 }] };
const RED = { in_sync: false, differing: ['cataloguesearch_prod'], indices: [bad] };

let compareBody;
let compareCalls;
let posts;
const mockServer = () => {
    compareCalls = 0;
    posts = [];
    global.fetch = jest.fn(async (url, opts) => {
        const u = String(url);
        const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
        if (opts?.method === 'POST') { posts.push({ url: u, body: JSON.parse(opts.body) }); return ok({ run_id: 'r1' }, 202); }
        if (u.endsWith('/deploy/compare')) {
            compareCalls += 1;
            if (compareBody instanceof Error) throw compareBody;
            return ok(compareBody);
        }
        if (u.endsWith('/deploy/config')) return ok({
            actions: [{ id: 'copy_snapshots', title: 'Copy' }, { id: 'restore_prod', title: 'Restore' }],
            build_services: [], default_build_services: [], prod_host: 'swalakshya-prod', build_env_file: '.env.local',
        });
        if (u.endsWith('/deploy/overview')) return ok({ opensearch: { reachable: true, indices: [] }, registry: { reachable: false, tags: [] }, tooling: null });
        if (u.includes('/jobs/runs')) return ok({ runs: [], active_run_id: null });
        return ok({});
    });
};
const renderPage = () => render(<MemoryRouter><DeployPage /></MemoryRouter>);
const syncButton = () => screen.getAllByRole('button', { name: 'Run' })[1];   // build card first, OpenSearch card second
const verdict = () => screen.findByTestId('compare-verdict');

beforeEach(() => { compareBody = GREEN; mockServer(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('compares by itself when the page opens, inside the OpenSearch card', async () => {
    renderPage();
    expect(await verdict()).toHaveTextContent('In sync');
    expect(screen.getByTestId('compare-box').closest('div.bg-white')).toHaveTextContent('Deploy OpenSearch to prod');
    expect(compareCalls).toBe(1);
});

test('compares again every five minutes, but not while the tab is hidden', async () => {
    expect(COMPARE_EVERY_MS).toBe(5 * 60 * 1000);
    jest.useFakeTimers();
    renderPage();
    await act(async () => { await Promise.resolve(); });
    expect(compareCalls).toBe(1);
    await act(async () => { jest.advanceTimersByTime(COMPARE_EVERY_MS); });
    expect(compareCalls).toBe(2);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    await act(async () => { jest.advanceTimersByTime(COMPARE_EVERY_MS); });
    expect(compareCalls).toBe(2);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

test('syncing while everything is green asks first and says why', async () => {
    renderPage();
    await verdict();
    fireEvent.click(syncButton());
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Prod already matches dev');
    expect(posts).toHaveLength(0);
});

test('syncing with differences does not mention the match warning, and still needs the typed prod confirmation', async () => {
    compareBody = RED;
    renderPage();
    expect(await verdict()).toHaveTextContent('Differences in 1 of 1');
    expect(screen.getByText(/New Granth · 42 chunks/)).toBeInTheDocument();
    fireEvent.click(syncButton());
    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent('Prod already matches dev');
    expect(posts).toHaveLength(0);
    fireEvent.change(dialog.querySelector('input'), { target: { value: 'prod' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body.actions).toEqual(['copy_snapshots', 'restore_prod']);
});

test('when the comparison fails the sync is not treated as green and the reason is shown', async () => {
    compareBody = new Error('prod: ssh failed');
    renderPage();
    await waitFor(() => expect(screen.getByText(/Could not compare: prod: ssh failed/)).toBeInTheDocument());
    fireEvent.click(syncButton());
    expect(await screen.findByRole('dialog')).not.toHaveTextContent('Prod already matches dev');
});
