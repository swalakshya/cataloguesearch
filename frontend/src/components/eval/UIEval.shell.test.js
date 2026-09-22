/**
 * Eval inside the Dev shell: the slim bar replaces the old title / tab card / paths block, the tools fill the window,
 * and Full screen hides the Dev bar. Real UIEval + PDFParser + DevShell; pdf.js, the network and unrelated tools are stubbed.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import DevShell from '../dev/DevShell';
import UIEval from './UIEval';

jest.mock('../../hooks/usePDFViewer', () => ({
    __esModule: true,
    default: () => new Proxy({ pdfDoc: null, currentPage: 1, totalPages: 1, previewUrl: null, croppedPreviewUrl: null, bookmarks: [] },
        { get: (t, p) => (p in t ? t[p] : () => {}) }),
}));
jest.mock('./lib/directoryHandlers', () => ({
    storeDirectoryHandles: jest.fn(), getStoredDirectoryHandles: async () => ({}), validateDirectoryHandles: async () => false,
    requestStoredPermissions: jest.fn(), clearStoredDirectoryHandles: jest.fn(),
}));
jest.mock('./FileBrowser', () => ({ __esModule: true, default: () => null }));
jest.mock('./ParagraphGenEval', () => ({ __esModule: true, default: ({ fill }) => <div data-testid="gen-eval" data-fill={String(!!fill)} /> }));
jest.mock('./OCRPreview', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('./ParaClassifier', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('./UnindexedPDFs', () => ({ __esModule: true, default: () => <div data-testid="unindexed" /> }));
jest.mock('./BookmarkBackfill', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('./LoadTest', () => ({ __esModule: true, default: () => <div /> }));

const PATHS = { base_pdf_path: '/pdf-root', base_ocr_path: '/ocr-root', base_text_path: '/text-root' };
const renderEval = (query = '') => {
    window.history.pushState({}, '', `/eval${query}`);
    return render(
        <MemoryRouter initialEntries={['/eval']}>
            <Routes><Route element={<DevShell />}><Route path="/eval" element={<UIEval />} /></Route></Routes>
        </MemoryRouter>);
};
const topInput = () => screen.getByText('Top %').parentElement.querySelector('input');
const bar = () => screen.getByTestId('eval-bar');

beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn(async (url) => {
        const u = String(url);
        if (u.includes('/jobs/runs')) return { ok: true, status: 200, json: async () => ({ runs: [], active_run_id: null }) };
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => PATHS };
    });
});
afterEach(() => { jest.restoreAllMocks(); });

test('the old title, tab card and always-open paths block are gone; the slim bar and the Dev bar are there', async () => {
    renderEval('?tab=pdf-parser');
    await screen.findByTestId('eval-bar');
    expect(screen.queryByText('Manual Evaluation UI')).not.toBeInTheDocument();
    expect(screen.queryByText('Tools for manual evaluation of OCR and paragraph generation')).not.toBeInTheDocument();
    expect(screen.queryByText('/pdf-root')).not.toBeInTheDocument();          // paths are behind the ⓘ now
    expect(screen.getByTestId('dev-nav')).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'PDF Parser' })).toHaveAttribute('aria-current', 'page');
});

test('the paths popover shows the paths loaded from the server', async () => {
    renderEval('?tab=pdf-parser');
    await screen.findByTestId('eval-bar');
    fireEvent.click(await within(bar()).findByRole('button', { name: 'Paths' }));
    expect(within(screen.getByRole('dialog', { name: 'Paths' })).getByText('/pdf-root')).toBeInTheDocument();
});

test('the tools fill the window: PDF Parser is not widened and Gen Eval is told to fill', async () => {
    renderEval('?tab=pdf-parser');
    await screen.findByTestId('eval-bar');
    expect(document.querySelector('[style*="max-width: none"]').style.width).toBe('100%');
    fireEvent.click(within(bar()).getByRole('button', { name: 'Gen Eval' }));
    expect(await screen.findByTestId('gen-eval')).toHaveAttribute('data-fill', 'true');
});

test('switching to a tool under More works, and that page is an ordinary scrolling page', async () => {
    renderEval('?tab=pdf-parser');
    await screen.findByTestId('eval-bar');
    fireEvent.click(within(bar()).getByRole('button', { name: /More/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unindexed PDFs' }));
    expect(await screen.findByTestId('unindexed')).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: /Unindexed PDFs/ })).toBeInTheDocument();
});

// Full screen is only offered once a file is open (see the dedicated test below), so these all deep-link one in.
const FILE_QS = '&file=Granth/hindi/Book%20One/Book.pdf';
const openFullScreen = async (query = `?tab=pdf-parser${FILE_QS}`) => {
    const result = renderEval(query);
    await waitFor(() => expect(within(bar()).getByTestId('file-chip')).toHaveTextContent('Book.pdf'));
    fireEvent.click(within(bar()).getByRole('button', { name: /Full screen/ }));
    return result;
};

test('Full screen is only offered once a file is open', async () => {
    const first = renderEval('?tab=pdf-parser');
    await screen.findByTestId('eval-bar');
    expect(screen.queryByRole('button', { name: /Full screen/ })).not.toBeInTheDocument();
    first.unmount();
    renderEval(`?tab=pdf-parser${FILE_QS}`);
    await waitFor(() => expect(within(bar()).getByTestId('file-chip')).toHaveTextContent('Book.pdf'));
    expect(within(bar()).getByRole('button', { name: /Full screen/ })).toBeInTheDocument();
});

test('Full screen hides the Dev bar AND the Eval bar for more room, keeps what you typed, and only Esc brings them back', async () => {
    renderEval(`?tab=pdf-parser${FILE_QS}`);
    await waitFor(() => expect(within(bar()).getByTestId('file-chip')).toHaveTextContent('Book.pdf'));
    fireEvent.change(topInput(), { target: { value: '15' } });
    fireEvent.click(within(bar()).getByRole('button', { name: /Full screen/ }));
    expect(screen.queryByTestId('dev-nav')).not.toBeInTheDocument();
    expect(screen.queryByTestId('eval-bar')).not.toBeInTheDocument();     // hidden together with the Dev bar, not just persistent
    expect(topInput()).toHaveValue(15);                                   // same tool instance: nothing reloaded

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('dev-nav')).toBeInTheDocument();
    expect(screen.getByTestId('eval-bar')).toBeInTheDocument();           // both bars return together
    expect(topInput()).toHaveValue(15);
});

test('a small fallback button stays visible in full screen, so Esc is never the only way out', async () => {
    await openFullScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(screen.getByTestId('dev-nav')).toBeInTheDocument();
    expect(screen.getByTestId('eval-bar')).toBeInTheDocument();
});

test('full screen is remembered, so a link from Discover opens Eval already in it (both bars start hidden)', async () => {
    const first = await openFullScreen();
    expect(screen.queryByTestId('eval-bar')).not.toBeInTheDocument();
    first.unmount();
    renderEval(`?tab=pdf-parser${FILE_QS}`);
    await waitFor(() => expect(topInput()).toBeInTheDocument());          // eval-bar itself is hidden; wait for the tool instead
    expect(screen.queryByTestId('dev-nav')).not.toBeInTheDocument();
    expect(screen.queryByTestId('eval-bar')).not.toBeInTheDocument();
});

test('the file chip shows the file opened by a deep link (as from Discover) and offers to browse otherwise', async () => {
    renderEval('?tab=pdf-parser&file=Granth/hindi/Book%20One/Book.pdf');
    await waitFor(() => expect(within(bar()).getByTestId('file-chip')).toHaveTextContent('Book.pdf'));
});

test('the chip invites you to pick a file when none is open', async () => {
    renderEval('?tab=pdf-parser');
    expect(await within(await screen.findByTestId('eval-bar')).findByTestId('file-chip')).toHaveTextContent('Browse files…');
});

test('the Eval home tab is still there for the mode and permission setup', async () => {
    renderEval('');
    await screen.findByTestId('eval-bar');
    expect(within(bar()).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(within(bar()).queryByTestId('file-chip')).not.toBeInTheDocument();     // Home takes no file
});
