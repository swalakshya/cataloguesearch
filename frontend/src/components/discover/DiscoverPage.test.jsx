import React from 'react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import DiscoverPage from './DiscoverPage';

const file = (dir, status) => ({ filename: 'x.pdf', relative_path: `${dir}/x.pdf`, status, sub_sections: null, last_indexed: null, batch: null });
const folder = (dir, counts, extra = {}) => {
    const c = { not_indexed: 0, ocred: 0, indexed: 0, ...counts };
    return { dir, runnable: true, counts: c, pending: c.not_indexed + c.ocred, batch_pending: 0, files: Object.entries(c).flatMap(([status, count]) => Array.from({ length: count }, (_, i) => ({ ...file(dir, status), filename: `${status}-${i}.pdf`, relative_path: `${dir}/${status}-${i}.pdf` }))), ...extra };
};
const statusOf = (folders) => {
    const counts = folders.reduce((total, f) => ({
        not_indexed: total.not_indexed + f.counts.not_indexed,
        ocred: total.ocred + f.counts.ocred,
        indexed: total.indexed + f.counts.indexed,
    }), { not_indexed: 0, ocred: 0, indexed: 0 });
    return {
        generated_at: new Date().toISOString(), base_pdf_path: '/x',
        totals: { ...counts, files: counts.not_indexed + counts.ocred + counts.indexed, pending: counts.not_indexed + counts.ocred },
        categories: [{ name: 'Granth', counts, folders }],
    };
};
const A = folder('Granth/A', { not_indexed: 1 });              // needs OCR
const B = folder('Granth/B', { ocred: 1, indexed: 2 });        // OCRed, plus indexed files
const C = folder('Granth/C', { indexed: 3 });                  // done
const D = folder('', { not_indexed: 1 }, { runnable: false }); // not under a scan_config folder

let posts;
const mockApi = (folders = [A, B, C], { startStatus = 202, statusData = null } = {}) => {
    posts = [];
    global.fetch = vi.fn(async (url, opts) => {
        const u = String(url);
        const json = async () => {
            if (u.includes('/discover/status')) return statusData || statusOf(folders);
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

afterEach(() => { vi.restoreAllMocks(); });

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
    fireEvent.click(screen.getByLabelText('Show indexed files'));
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
    expect(posts[0].body).toEqual({ folders: ['Granth/B', 'Granth/A'], mode: 'index' });
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
    expect(screen.queryByLabelText('Select Granth/C')).not.toBeInTheDocument(); // completed folder is hidden
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


test('default view hides completed folders and indexed files inside mixed folders', async () => {
    mockApi(); await renderPage();
    expect(screen.getByLabelText('Show indexed files')).not.toBeChecked();
    expect(screen.queryByLabelText('Select Granth/C')).not.toBeInTheDocument();
    const row = screen.getByLabelText('Select Granth/B').closest('div.border');
    expect(within(row).getByText('ocred-0.pdf')).toBeInTheDocument();
    expect(within(row).queryByText('indexed-0.pdf')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show indexed files'));
    expect(screen.getByLabelText('Select Granth/C')).toBeInTheDocument();
    expect(within(row).getByText('indexed-0.pdf')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Re-index' })).toBeEnabled();
});

test('turning off indexed files clears hidden selections', async () => {
    mockApi(); await renderPage();
    fireEvent.click(screen.getByLabelText('Show indexed files'));
    tick('Granth/C');
    expect(bar()).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show indexed files'));
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show indexed files'));
    expect(screen.getByLabelText('Select Granth/C')).not.toBeChecked();
});

test('newly indexed folders disappear after rescan', async () => {
    mockApi(); await renderPage();
    tick('Granth/A');
    mockApi([folder('Granth/A', { indexed: 1 }), B, C]);
    fireEvent.click(screen.getByText('rescan'));
    await waitFor(() => expect(screen.queryByLabelText('Select Granth/A')).not.toBeInTheDocument());
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select Granth/B')).toBeInTheDocument();
});

test('completed categories are hidden by default and remain available through the toggle', async () => {
    mockApi([C]);
    render(<MemoryRouter><DiscoverPage /></MemoryRouter>);
    expect(await screen.findByText(/No pending files/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Granth.*folders/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show indexed files'));
    fireEvent.click(screen.getByText('Show folders'));
    expect(screen.getByLabelText('Select Granth/C')).toBeInTheDocument();
});

test('folders and files sort OCRed first, then not indexed, then indexed', async () => {
    const mixed = folder('Granth/D', { ocred: 1, not_indexed: 1, indexed: 1 });
    mockApi([A, C, mixed, B]); await renderPage();
    fireEvent.click(screen.getByLabelText('Show indexed files'));
    const folders = screen.getAllByRole('checkbox', { name: /^Select Granth\// }).map((input) => input.getAttribute('aria-label'));
    expect(folders).toEqual(['Select Granth/B', 'Select Granth/D', 'Select Granth/A', 'Select Granth/C']);
    const row = screen.getByLabelText('Select Granth/D').closest('div.border');
    const files = within(row).getAllByText(/\.pdf$/).map((element) => element.textContent);
    expect(files).toEqual(['ocred-0.pdf', 'not_indexed-0.pdf', 'indexed-0.pdf']);
});

test('global status pills filter the list and Select pending selects only matching folders', async () => {
    mockApi(); await renderPage();
    const pill = screen.getByRole('button', { name: 'Filter OCRed files' });
    fireEvent.click(pill);
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Select Granth/A')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select Granth/B')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Select pending'));
    expect(within(bar()).getByText('1 folder selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filter Not indexed files' }));
    expect(screen.queryByLabelText('Select Granth/B')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select Granth/A')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear status filter'));
    expect(screen.getByLabelText('Select Granth/B')).toBeInTheDocument();
});

test('category pills filter within that category and can be toggled off', async () => {
    mockApi(); await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Filter Granth OCRed files' }));
    expect(screen.getByText('Showing OCRed files in Granth')).toBeInTheDocument();
    expect(screen.queryByLabelText('Select Granth/A')).not.toBeInTheDocument();
    const pill = screen.getByRole('button', { name: 'Filter Granth OCRed files' });
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pill);
    expect(screen.getByLabelText('Select Granth/A')).toBeInTheDocument();
});

test('Indexed pill reveals completed files; hiding indexed files clears its filter', async () => {
    mockApi(); await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Filter Indexed files' }));
    expect(screen.getByLabelText('Show indexed files')).toBeChecked();
    expect(screen.queryByLabelText('Select Granth/A')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select Granth/C')).toBeInTheDocument();
    expect(screen.getByText('Select pending')).toBeDisabled();
    const row = screen.getByLabelText('Select Granth/B').closest('div.border');
    expect(within(row).queryByText('ocred-0.pdf')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show indexed files'));
    expect(screen.queryByText('Showing Indexed files')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Select Granth/C')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select Granth/A')).toBeInTheDocument();
});


test('category status filter excludes matching files from other categories', async () => {
    const books = folder('Books/Ready', { ocred: 1 });
    const data = statusOf([A, B, C, books]);
    data.categories = [
        { name: 'Granth', counts: statusOf([A, B, C]).categories[0].counts, folders: [A, B, C] },
        { name: 'Books', counts: books.counts, folders: [books] },
    ];
    mockApi([A, B, C, books], { statusData: data }); await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Filter Books OCRed files' }));
    expect(screen.getByLabelText('Select Books/Ready')).toBeInTheDocument();
    expect(screen.queryByLabelText('Select Granth/B')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Select pending'));
    expect(within(bar()).getByText('1 folder selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filter OCRed files' }));
    expect(screen.getByLabelText('Select Granth/B')).toBeInTheDocument();
});
