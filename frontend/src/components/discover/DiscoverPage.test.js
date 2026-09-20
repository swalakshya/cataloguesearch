import React from 'react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import DiscoverPage from './DiscoverPage';

const file = (dir, status) => ({ filename: 'x.pdf', relative_path: `${dir}/x.pdf`, status, sub_sections: null, last_indexed: null, batch: null });
const folder = (dir, counts, extra = {}) => {
    const c = { not_indexed: 0, ocred: 0, indexed: 0, ...counts };
    return { dir, runnable: true, counts: c, pending: c.not_indexed + c.ocred, batch_pending: 0, files: [file(dir, 'indexed')], ...extra };
};
const statusOf = (folders) => ({
    generated_at: new Date().toISOString(), base_pdf_path: '/x',
    totals: { not_indexed: 1, ocred: 1, indexed: 5, files: 7, pending: 2 },
    categories: [{ name: 'Granth', counts: { not_indexed: 1, ocred: 1, indexed: 5 }, folders }],
});
const A = folder('Granth/A', { not_indexed: 1 });              // needs OCR
const B = folder('Granth/B', { ocred: 1, indexed: 2 });        // OCRed, plus indexed files
const C = folder('Granth/C', { indexed: 3 });                  // done
const D = folder('', { not_indexed: 1 }, { runnable: false }); // not under a scan_config folder

let posts;
const mockApi = (folders = [A, B, C], { startStatus = 202 } = {}) => {
    posts = [];
    global.fetch = jest.fn(async (url, opts) => {
        const u = String(url);
        const json = async () => {
            if (u.includes('/discover/status')) return statusOf(folders);
            if (u.includes('/discover/runs')) return startStatus === 202 ? { run_id: 'run1' } : { detail: 'Run x is already in progress' };
            return { runs: [], active_run_id: null };
        };
        if (opts?.method === 'POST') posts.push({ url: u, body: JSON.parse(opts.body) });
        return { ok: !(opts?.method === 'POST' && startStatus !== 202), status: opts?.method === 'POST' ? startStatus : 200, json };
    });
};

const renderPage = async () => {
    render(<MemoryRouter><DiscoverPage /></MemoryRouter>);
    await screen.findByLabelText('Select Granth/A');
};
const tick = (dir) => fireEvent.click(screen.getByLabelText(`Select ${dir}`));
const bar = () => screen.getByTestId('selection-bar');
const barBtn = (name) => within(bar()).getByRole('button', { name });

afterEach(() => { jest.restoreAllMocks(); });

test('no selection bar until a folder is ticked; ticking shows how many and what will happen', async () => {
    mockApi(); await renderPage();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    tick('Granth/A'); tick('Granth/B');
    expect(within(bar()).getByText('2 folders selected')).toBeInTheDocument();
    expect(within(bar()).getByText(/OCR needed in 1 · 2 to index · 1 already indexed/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select Granth/B'));
    expect(within(bar()).getByText('1 folder selected')).toBeInTheDocument();
});

test('the bar enables only the actions that apply to the selection', async () => {
    mockApi(); await renderPage();
    tick('Granth/C');                                   // fully indexed
    expect(barBtn('OCR only')).toBeDisabled();
    expect(barBtn('Index')).toBeDisabled();
    expect(barBtn('Re-index')).toBeEnabled();
    tick('Granth/C'); tick('Granth/A');                 // needs OCR, nothing indexed
    expect(barBtn('OCR only')).toBeEnabled();
    expect(barBtn('Index')).toBeEnabled();
    expect(barBtn('Re-index')).toBeDisabled();
    tick('Granth/B');                                   // has OCR + indexed files
    expect(barBtn('Re-index')).toBeEnabled();
});

test('Index on several folders is one request for all of them, then the selection clears', async () => {
    mockApi(); await renderPage();
    tick('Granth/A'); tick('Granth/B');
    fireEvent.click(barBtn('Index'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toMatch(/\/discover\/runs$/);
    expect(posts[0].body).toEqual({ folders: ['Granth/A', 'Granth/B'], mode: 'index' });
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument());
});

test('OCR only and Re-index send their own mode', async () => {
    mockApi(); await renderPage();
    tick('Granth/A'); fireEvent.click(barBtn('OCR only'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ folders: ['Granth/A'], mode: 'ocr' });
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument());   // selection cleared after the run started
    tick('Granth/B'); fireEvent.click(barBtn('Re-index'));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].body).toEqual({ folders: ['Granth/B'], mode: 'reindex' });
});

test('"Select pending" ticks every folder with work to do, and Clear unticks them', async () => {
    mockApi(); await renderPage();
    fireEvent.click(screen.getByText('Select pending'));
    expect(screen.getByLabelText('Select Granth/A')).toBeChecked();
    expect(screen.getByLabelText('Select Granth/B')).toBeChecked();
    expect(screen.getByLabelText('Select Granth/C')).not.toBeChecked();      // nothing pending there
    expect(within(bar()).getByText('2 folders selected')).toBeInTheDocument();
    fireEvent.click(within(bar()).getByText('Clear'));
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
});

test('a folder that cannot be targeted has a disabled checkbox and is not picked by "Select pending"', async () => {
    mockApi([A, D]); await renderPage();
    expect(screen.getByLabelText('Select (no scan_config folder)')).toBeDisabled();
    fireEvent.click(screen.getByText('Select pending'));
    expect(within(bar()).getByText('1 folder selected')).toBeInTheDocument();
});

test('if starting the run fails, the error is shown and the selection is kept', async () => {
    mockApi([A, B, C], { startStatus: 409 }); await renderPage();
    tick('Granth/A');
    fireEvent.click(barBtn('Index'));
    expect(await screen.findByText(/already in progress/)).toBeInTheDocument();
    expect(screen.getByLabelText('Select Granth/A')).toBeChecked();
});

test('a rescan that drops a selected folder drops it from the selection', async () => {
    mockApi(); await renderPage();
    tick('Granth/A'); tick('Granth/B');
    mockApi([A, C]);                                     // B is gone after a cleanup + rescan
    fireEvent.click(screen.getByText('rescan'));
    await waitFor(() => expect(within(bar()).getByText('1 folder selected')).toBeInTheDocument());
});

test('the per-row buttons still run a single folder', async () => {
    mockApi(); await renderPage();
    const row = screen.getByLabelText('Select Granth/A').closest('div.border');
    fireEvent.click(within(row).getByRole('button', { name: 'Index' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ folders: ['Granth/A'], mode: 'index' });
});
