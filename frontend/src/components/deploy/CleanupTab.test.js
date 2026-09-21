import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import CleanupTab, { formatBytes } from './CleanupTab';

const cat = (id, title, extra) => ({ id, title, description: `${title} description`, safe: true, count: 1, size: 0, reclaimable: 0, items: [], ...extra });
const SCAN = (label = 'This machine', target = 'local') => ({
    target, label, generated_at: new Date().toISOString(),
    totals: { safe: 14_501_100_000, optional: 8_700_000_000 },
    categories: [
        cat('dangling_images', 'Dangling images', { count: 3, size: 1_200_000_000, reclaimable: 1_200_000_000, items: [{ name: '<untagged> 04bd680f5738', size: 800_000_000 }] }),
        cat('build_cache', 'Build cache', {
            count: 72, size: 13_300_000_000, reclaimable: 13_300_000_000,
            variants: [{ id: 'older', label: 'Older than 7 days', count: 30, reclaimable: 3_300_000_000 }, { id: 'all', label: 'All', count: 72, reclaimable: 13_300_000_000 }],
        }),
        cat('stopped_containers', 'Stopped containers', { size: 1_100_000, reclaimable: 1_100_000 }),
        cat('unused_networks', 'Unused networks', { size: null, reclaimable: 0 }),
        cat('unused_images', 'Unused tagged images', {
            safe: false, count: 4, size: 1_800_000_000, reclaimable: 1_800_000_000, description: 'Tagged images no container uses.',
            items: [{ name: 'python:3.13-slim', size: 259_000_000 }],
            protected: { count: 3, size: 1_600_000_000, items: [{ name: 'swalakshya/cataloguesearch:api', size: 1_400_000_000, note: 'kept' }] },
        }),
        cat('snapshot_files', 'Snapshot files', { safe: false, count: 2, size: 6_900_000_000, reclaimable: 6_900_000_000, description: 'The snapshots folder and tarball.' }),
    ],
    volumes: { count: 6, unused: 4, unused_size: 4_600_000_000, items: [{ name: 'opensearch-data', size: 3_700_000_000, note: 'in use' }, { name: 'forgotten', size: 4_600_000_000, note: 'unused' }] },
});

let posts;
let activeRun;
const mockApi = ({ scans = {}, startStatus = 202 } = {}) => {
    posts = [];
    global.fetch = jest.fn(async (url, opts) => {
        const u = String(url);
        const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
        if (opts?.method === 'POST') {
            posts.push({ url: u, body: JSON.parse(opts.body) });
            return startStatus === 202 ? ok({ run_id: 'run1' }, 202) : ok({ detail: 'Run x is already in progress' }, startStatus);
        }
        if (u.includes('/deploy/gc/scan')) {
            const target = new URL(u, 'http://x').searchParams.get('target');
            const handler = scans[target];
            if (handler) return handler();
            return ok(SCAN(target === 'prod' ? 'Prod (swalakshya-prod)' : 'This machine', target));
        }
        if (u.includes('/jobs/runs')) return ok({ runs: [], active_run_id: activeRun });
        return ok({});
    });
};
const renderTab = async () => { render(<CleanupTab prodHost="swalakshya-prod" />); await screen.findByTestId('headline'); };
const row = (id) => screen.getByTestId(`row-${id}`);
const cleanIn = (id) => within(row(id)).getByRole('button', { name: /^Clean/ });
const bar = () => screen.getByTestId('selection-bar');

beforeEach(() => { activeRun = null; mockApi(); });
afterEach(() => { jest.restoreAllMocks(); });

test('formatBytes uses docker-style decimal units', () => {
    expect([0, 999, 1000, 1_500_000, 13_260_000_000, 2_400_000_000_000].map(formatBytes)).toEqual(['0 B', '999 B', '1.0 KB', '1.5 MB', '13.3 GB', '2.4 TB']);
});

test('shows every category with what can be freed, the safe total, and marks the optional ones', async () => {
    await renderTab();
    expect(screen.getByTestId('headline')).toHaveTextContent('14.5 GB can be freed safely');
    expect(screen.getByTestId('size-dangling_images')).toHaveTextContent('1.2 GB');
    expect(screen.getByTestId('size-build_cache')).toHaveTextContent('13.3 GB');
    expect(screen.getByTestId('size-unused_networks')).toHaveTextContent('—');                       // no meaningful size for networks
    expect(within(row('unused_images')).getByText('OPTIONAL')).toBeInTheDocument();
    expect(within(row('snapshot_files')).getByText('OPTIONAL')).toBeInTheDocument();
    expect(within(row('dangling_images')).queryByText('OPTIONAL')).not.toBeInTheDocument();
    expect(screen.getByText(/A further/)).toHaveTextContent('8.7 GB');
});

test('the images your compose files name are shown as kept, not offered for removal', async () => {
    await renderTab();
    expect(screen.getByTestId('kept-unused_images')).toHaveTextContent('3 kept');
    expect(screen.queryByTestId('kept-dangling_images')).not.toBeInTheDocument();                 // only rows that have protected items
    expect(screen.queryByText('swalakshya/cataloguesearch:api')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show Unused tagged images details'));
    expect(screen.getByText('python:3.13-slim')).toBeInTheDocument();                               // removable
    const kept = screen.getByTestId('protected-unused_images');
    expect(within(kept).getByText(/named in your compose files, never removed here \(1\.6 GB\)/)).toBeInTheDocument();
    expect(within(kept).getByText('swalakshya/cataloguesearch:api')).toBeInTheDocument();
});

test('the confirmation for removing images says which ones are kept', async () => {
    await renderTab();
    fireEvent.click(cleanIn('unused_images'));
    const dialog = screen.getByRole('dialog', { name: 'Remove optional items?' });
    expect(within(dialog).getByText(/Kept, not touched: swalakshya\/cataloguesearch:api/)).toBeInTheDocument();
});

test('a row expands to show what is in it', async () => {
    await renderTab();
    expect(screen.queryByText('<untagged> 04bd680f5738')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show Dangling images details'));
    expect(screen.getByText('<untagged> 04bd680f5738')).toBeInTheDocument();
});

test('volumes are listed for information only: no checkbox, no clean button', async () => {
    await renderTab();
    const card = screen.getByText('Volumes (not cleaned here)').closest('div.border');
    expect(within(card).getByText(/listed for information only/)).toBeInTheDocument();
    expect(within(card).getByText(/forgotten/)).toBeInTheDocument();
    expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Select Volumes/)).not.toBeInTheDocument();
});

test('"Clean all safe" on this machine runs the four safe items at once, with no confirmation', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Clean all safe/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toMatch(/\/deploy\/gc\/run$/);
    expect(posts[0].body).toEqual({
        target: 'local', confirm: false,
        categories: [{ id: 'dangling_images' }, { id: 'build_cache', variant: 'all' }, { id: 'stopped_containers' }, { id: 'unused_networks' }],
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a single safe item cleans just that one', async () => {
    await renderTab();
    fireEvent.click(cleanIn('dangling_images'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ target: 'local', confirm: false, categories: [{ id: 'dangling_images' }] });
});

test('build cache can be cleared all at once or only what is older than 7 days, and the amount follows the choice', async () => {
    await renderTab();
    fireEvent.change(within(row('build_cache')).getByLabelText('Build cache scope'), { target: { value: 'older' } });
    expect(screen.getByTestId('size-build_cache')).toHaveTextContent('3.3 GB');
    fireEvent.click(cleanIn('build_cache'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body.categories).toEqual([{ id: 'build_cache', variant: 'older' }]);
});

test('optional items always ask first: typed confirmation, then the request says it was confirmed', async () => {
    await renderTab();
    fireEvent.click(cleanIn('unused_images'));
    const dialog = screen.getByRole('dialog', { name: 'Remove optional items?' });
    expect(within(dialog).getByText('Tagged images no container uses.')).toBeInTheDocument();       // says what will be removed
    expect(posts).toHaveLength(0);
    const run = screen.getByRole('button', { name: 'Clean up' });
    expect(run).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'clean' } });
    expect(run).toBeEnabled();
    fireEvent.click(run);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ target: 'local', confirm: true, categories: [{ id: 'unused_images' }] });
});

test('cancelling the confirmation sends nothing', async () => {
    await renderTab();
    fireEvent.click(cleanIn('snapshot_files'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Remove optional items?')).not.toBeInTheDocument();
    expect(posts).toHaveLength(0);
});

test('ticking rows builds a selection with a running total, and cleans exactly those', async () => {
    await renderTab();
    fireEvent.click(screen.getByLabelText('Select Dangling images'));
    fireEvent.click(screen.getByLabelText('Select Stopped containers'));
    expect(within(bar()).getByText(/2 selected · about 1.2 GB/)).toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Clean selected' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body.categories).toEqual([{ id: 'dangling_images' }, { id: 'stopped_containers' }]);
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument());     // cleared once started
});

test('a selection that includes an optional item needs the typed confirmation', async () => {
    await renderTab();
    fireEvent.click(screen.getByLabelText('Select Dangling images'));
    fireEvent.click(screen.getByLabelText('Select Snapshot files'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Clean selected' }));
    expect(screen.getByText('Remove optional items?')).toBeInTheDocument();
    expect(posts).toHaveLength(0);
});

describe('prod', () => {
    test('switching machine scans that machine', async () => {
        await renderTab();
        fireEvent.click(screen.getByRole('tab', { name: /Prod/ }));
        await waitFor(() => expect(screen.getByText(/Prod \(swalakshya-prod\)\./)).toBeInTheDocument());
        expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/deploy/gc/scan?target=prod'))).toBe(true);
    });

    test('everything on prod, even the safe items, needs the typed word "prod"', async () => {
        await renderTab();
        fireEvent.click(screen.getByRole('tab', { name: /Prod/ }));
        await waitFor(() => expect(screen.getByText(/Prod \(swalakshya-prod\)\./)).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Clean all safe/ }));
        expect(screen.getByText('Clean up prod (swalakshya-prod)?')).toBeInTheDocument();
        expect(posts).toHaveLength(0);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'clean' } });
        expect(screen.getByRole('button', { name: 'Clean up' })).toBeDisabled();                       // the wrong word is not enough
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'prod' } });
        fireEvent.click(screen.getByRole('button', { name: 'Clean up' }));
        await waitFor(() => expect(posts).toHaveLength(1));
        expect(posts[0].body.target).toBe('prod');
        expect(posts[0].body.confirm).toBe(true);
    });

    test('an answer from a machine you have already left does not overwrite the current one', async () => {
        let releaseLocal;
        mockApi({ scans: { local: () => new Promise((resolve) => { releaseLocal = () => resolve({ ok: true, status: 200, json: async () => SCAN('This machine', 'local') }); }) } });
        render(<CleanupTab prodHost="swalakshya-prod" />);
        fireEvent.click(screen.getByRole('tab', { name: /Prod/ }));
        await waitFor(() => expect(screen.getByText(/Prod \(swalakshya-prod\)\./)).toBeInTheDocument());
        releaseLocal();
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.getByText(/Prod \(swalakshya-prod\)\./)).toBeInTheDocument();
        expect(screen.queryByText(/This machine\./)).not.toBeInTheDocument();
    });
});

test('an unreachable machine shows why, instead of an empty page', async () => {
    mockApi({ scans: { local: async () => ({ ok: false, status: 503, json: async () => ({ detail: "Docker isn't reachable on this machine. Is OrbStack / Docker running?" }) }) } });
    render(<CleanupTab prodHost="swalakshya-prod" />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Docker isn't reachable");
    expect(screen.queryByTestId('headline')).not.toBeInTheDocument();
});

test('when nothing is safe to clean the big button says so and is disabled', async () => {
    const empty = SCAN();
    empty.categories = empty.categories.map((c) => ({ ...c, reclaimable: 0, size: 0, count: 0 }));
    empty.totals = { safe: 0, optional: 0 };
    mockApi({ scans: { local: async () => ({ ok: true, status: 200, json: async () => empty }) } });
    render(<CleanupTab prodHost="swalakshya-prod" />);
    expect(await screen.findByText('Nothing safe to clean')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clean all safe/ })).toBeDisabled();
});

test('while another job is running nothing can be started', async () => {
    activeRun = 'someone-else';
    await renderTab();
    await waitFor(() => expect(screen.getByRole('button', { name: /A job is in progress/ })).toBeDisabled());
    expect(cleanIn('dangling_images')).toBeDisabled();
});

test('if the server refuses to start it, the reason is shown and the selection is kept', async () => {
    mockApi({ startStatus: 409 });
    await renderTab();
    fireEvent.click(screen.getByLabelText('Select Dangling images'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Clean selected' }));
    expect(await screen.findByText(/already in progress/)).toBeInTheDocument();
    expect(screen.getByLabelText('Select Dangling images')).toBeChecked();
});
