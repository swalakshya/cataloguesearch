/**
 * Opening a library file in PDF Parser fills the controls from that file's scan_config.
 * Renders the real component; only the PDF viewer hook (pdf.js) and the network are stubbed.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import PDFParser from './PDFParser';

// pdf.js needs a real browser; every viewer function becomes a no-op and the state values are inert.
let mockPdfDoc = null; // set per test: what pdf.js would hand back once the PDF is open
jest.mock('../../hooks/usePDFViewer', () => ({
    __esModule: true,
    default: () => new Proxy({
        pdfDoc: mockPdfDoc, currentPage: 1, totalPages: 1, previewUrl: null, croppedPreviewUrl: null, bookmarks: [],
        loadPDF: async () => {},
    }, { get: (t, p) => (p in t ? t[p] : () => {}) }),
}));

const LOK_VIBHAG = { crop: { top: 9, bottom: 4 }, ocr_engine: 'llm', language: 'hi', start_page: 12, end_page: 280 };

// A directory handle whose every folder is itself and whose files are tiny PDFs.
const fakePdfRoot = () => {
    const dir = {
        getDirectoryHandle: async () => dir,
        getFileHandle: async (name) => ({ getFile: async () => new File(['%PDF-1.4'], name, { type: 'application/pdf' }) }),
    };
    return dir;
};

const selection = (extra = {}) => ({
    selectedPDFFile: 'LokVibhag.pdf',
    relativePath: 'Granth/hindi/Karananuyog/Lok Vibhag/LokVibhag',
    pdfFilePath: 'Granth/hindi/Karananuyog/Lok Vibhag/LokVibhag.pdf',
    ...extra,
});

const mockScanConfig = (cfg, ok = true) => {
    global.fetch = jest.fn(async (url) => {
        if (String(url).includes('/eval/ocr/scan-config')) return { ok, status: ok ? 200 : 404, json: async () => cfg };
        return { ok: true, status: 200, json: async () => ({}) };
    });
};

const renderParser = (props = {}) => render(
    <PDFParser selectedFile={selection()} baseDirectoryHandles={{ pdf: fakePdfRoot() }} {...props} />);

const cropInput = (label) => screen.getByText(label).parentElement.querySelector('input');

afterEach(() => { jest.restoreAllMocks(); mockPdfDoc = null; });

test('the Lok Vibhag scan_config fills crop, engine and language, and says so', async () => {
    mockScanConfig(LOK_VIBHAG);
    renderParser();

    await waitFor(() => expect(cropInput('Top %').value).toBe('9'));
    expect(cropInput('Bottom %').value).toBe('4');
    expect(cropInput('Left %').value).toBe('0');
    expect(screen.getByRole('button', { name: 'LLM' }).className).toMatch(/bg-sky-600/);        // LLM mode is the active one
    expect(screen.getByRole('button', { name: 'Tesseract' }).className).not.toMatch(/bg-sky-600/);
    expect(screen.getByText(/settings from scan_config: LLM · Hindi · crop T9 B4/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gemini 2.5 Flash' }).selected).toBe(true);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes(
        `/eval/ocr/scan-config?relative_path=${encodeURIComponent('Granth/hindi/Karananuyog/Lok Vibhag/LokVibhag.pdf')}`))).toBe(true);
});

test('library files do not offer "Default scan config" (they always use their own)', async () => {
    mockScanConfig(LOK_VIBHAG);
    renderParser();
    await waitFor(() => expect(cropInput('Top %').value).toBe('9'));
    expect(screen.queryByText('Default scan config')).not.toBeInTheDocument();
});

test('an uploaded file (no library selection) keeps the defaults and the "Default scan config" option', () => {
    mockScanConfig(LOK_VIBHAG);
    renderParser({ selectedFile: null });
    expect(cropInput('Top %').value).toBe('0');
    expect(screen.getByRole('button', { name: 'Tesseract' }).className).toMatch(/bg-sky-600/);
    expect(screen.getByText('Default scan config')).toBeInTheDocument();
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('scan-config'))).toBe(false);
});

test('a config that sets only some things resets the rest to the defaults', async () => {
    mockScanConfig({ crop: { left: 7 }, language: 'gu', ocr_engine: 'tesseract', multi_page: true, split_percentage: 47 });
    renderParser();
    await waitFor(() => expect(cropInput('Left %').value).toBe('7'));
    expect(cropInput('Top %').value).toBe('0');
    expect(screen.getByRole('button', { name: 'Tesseract' }).className).toMatch(/bg-sky-600/);
    expect(screen.getByText(/Tesseract · Gujarati · crop L7 · multi-page 47%/)).toBeInTheDocument();
    expect(screen.getByLabelText('Multi-page PDF').checked).toBe(true);
});

test('if the scan_config cannot be read, the page still opens with the defaults (and no note)', async () => {
    mockScanConfig({ detail: 'nope' }, false);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderParser();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('LokVibhag.pdf')).toBeInTheDocument());
    expect(cropInput('Top %').value).toBe('0');
    expect(screen.queryByText(/settings from scan_config/)).not.toBeInTheDocument();
});


describe('Verify sub-sections', () => {
    const SUBS = [{ field: 'Adhikaar', name: 'Prastavana', start_page: 12, end_page: 39 },
        { field: 'Adhikaar', name: 'Pratham Vibhag', start_page: 56, end_page: 102 }];
    const openPdf = () => { mockPdfDoc = { numPages: 300, getPage: async () => { throw new Error('no canvas in jsdom'); } }; };

    test('a library file with sub-sections offers the view, and it opens and closes', async () => {
        openPdf();
        mockScanConfig({ ...LOK_VIBHAG, sub_sections: SUBS });
        renderParser();
        const button = await screen.findByRole('button', { name: 'Verify sub-sections (2)' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.click(button);
        const dialog = screen.getByRole('dialog', { name: 'Verify sub-sections' });
        expect(within(dialog).getByText('Adhikaar · Prastavana')).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('no button when the scan_config has no sub-sections', async () => {
        openPdf();
        mockScanConfig(LOK_VIBHAG);
        renderParser();
        await waitFor(() => expect(cropInput('Top %').value).toBe('9'));
        expect(screen.queryByRole('button', { name: /Verify sub-sections/ })).not.toBeInTheDocument();
    });

    test('no button before the PDF itself is open', async () => {
        mockScanConfig({ ...LOK_VIBHAG, sub_sections: SUBS });
        renderParser();                                    // pdfDoc is still null
        await waitFor(() => expect(cropInput('Top %').value).toBe('9'));
        expect(screen.queryByRole('button', { name: /Verify sub-sections/ })).not.toBeInTheDocument();
    });

    test('no button for an uploaded file', () => {
        openPdf();
        mockScanConfig({ ...LOK_VIBHAG, sub_sections: SUBS });
        renderParser({ selectedFile: null });
        expect(screen.queryByRole('button', { name: /Verify sub-sections/ })).not.toBeInTheDocument();
    });
});

describe('fill layout (panes sized to the window)', () => {
    const boxOf = (placeholder) => screen.getByText(placeholder).parentElement;

    test('default layout is unchanged: widened card and the fixed 700 / 660px boxes', () => {
        mockScanConfig(LOK_VIBHAG);
        const { container } = renderParser({ selectedFile: null });
        const cardEl = container.querySelector('[style*="max-width: none"]');
        expect(cardEl.style.width).toBe('130%');
        expect(boxOf('Select a PDF or image to preview').className).toMatch(/h-\[700px\]/);
        expect(boxOf('Select a file to see preview').className).toMatch(/h-\[660px\]/);
        expect(screen.getByText('PDF Parser', { selector: 'h2' }).parentElement.className).not.toMatch(/hidden/);
        expect(container.firstChild.className).toBe('');
    });

    test('fill mode: normal-width card, flex panes instead of fixed heights, no title block', () => {
        mockScanConfig(LOK_VIBHAG);
        const { container } = renderParser({ selectedFile: null, fill: true });
        expect(container.firstChild.className).toMatch(/h-full flex flex-col/);
        const cardEl = container.querySelector('[style*="max-width: none"]');
        expect(cardEl.style.width).toBe('100%');
        expect(cardEl.className).toMatch(/flex-1 min-h-0 flex flex-col/);
        for (const placeholder of ['Select a PDF or image to preview', 'Select a file to see preview']) {
            expect(boxOf(placeholder).className).toMatch(/flex-1 min-h-0/);
            expect(boxOf(placeholder).className).not.toMatch(/h-\[(700|660)px\]/);
        }
        expect(screen.getByText('PDF Parser', { selector: 'h2' }).parentElement.className).toMatch(/hidden/);
    });

    test('the controls never shrink away in fill mode', () => {
        mockScanConfig(LOK_VIBHAG);
        renderParser({ selectedFile: null, fill: true });
        expect(cropInput('Top %').closest('div.border-b').className).toMatch(/shrink-0/);
    });
});

describe('SET in Verify sub-sections', () => {
    const SUBS = [{ field: 'Adhikaar', name: 'Prastavana', start_page: 12, end_page: 39 }];
    const CFG = (editable) => ({ ...LOK_VIBHAG, sub_sections: SUBS,
        sub_sections_source: { editable, reason: editable ? '' : 'Read-only: this scan_config.json is not in the configs repo.', file: 'x/scan_config.json' } });
    const mockServer = (cfg, save) => {
        global.fetch = jest.fn(async (url, opts) => {
            if (String(url).includes('/sub-section-page')) return save(JSON.parse(opts.body));
            if (String(url).includes('/eval/ocr/scan-config')) return { ok: true, status: 200, json: async () => cfg };
            return { ok: true, status: 200, json: async () => ({}) };
        });
    };
    const openVerifier = async () => {
        mockPdfDoc = { numPages: 300, getPage: async () => { throw new Error('no canvas in jsdom'); } };
        renderParser();
        fireEvent.click(await screen.findByRole('button', { name: 'Verify sub-sections (1)' }));
        return screen.getByRole('dialog', { name: 'Verify sub-sections' });
    };

    test('SET sends the library file, the section and the page, and the list shows the new page', async () => {
        const saves = [];
        mockServer(CFG(true), async (body) => {
            saves.push(body);
            return { ok: true, status: 200, json: async () => ({ sub_sections: [{ ...SUBS[0], start_page: 13 }] }) };
        });
        const dialog = await openVerifier();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Start next page' }));
        fireEvent.click(await within(dialog).findByRole('button', { name: 'SET start = 13' }));
        await waitFor(() => expect(saves).toHaveLength(1));
        expect(saves[0]).toEqual({
            relative_path: 'Granth/hindi/Karananuyog/Lok Vibhag/LokVibhag.pdf', index: 0, which: 'start', page: 13,
            expect_name: 'Prastavana', expect_field: 'Adhikaar', expect_page: 12,
        });
        expect(await within(dialog).findByTestId('saved-note')).toHaveTextContent('start_page 12 → 13');
        expect(within(dialog).getByTestId('rail')).toHaveTextContent('13–39');
    });

    test('the server refusing the save is shown, and the list keeps the old page', async () => {
        mockServer(CFG(true), async () => ({ ok: false, status: 409, json: async () => ({ detail: 'The file changed since it was loaded (start_page is now 14). Reopen the file.' }) }));
        const dialog = await openVerifier();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Start next page' }));
        fireEvent.click(await within(dialog).findByRole('button', { name: 'SET start = 13' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('start_page is now 14');
        expect(within(dialog).getByTestId('rail')).toHaveTextContent('12–39');
    });

    test('a config that is not from the configs repo can be reviewed but has no SET', async () => {
        mockServer(CFG(false), async () => { throw new Error('must not be called'); });
        const dialog = await openVerifier();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Start next page' }));
        expect(within(dialog).queryByRole('button', { name: /SET/ })).toBeNull();
        expect(within(dialog).getByText(/not in the configs repo/)).toBeInTheDocument();
    });

    test('Remove and Merge go to their own endpoints for the opened library file, and the list follows the answer', async () => {
        const TWO = [SUBS[0], { field: 'Adhikaar', name: 'Second', start_page: 40, end_page: 60 }];
        const posts = [];
        global.fetch = jest.fn(async (url, opts) => {
            const u = String(url);
            if (u.includes('/sub-sections/')) {
                posts.push({ url: u.split('/sub-sections/')[1], body: JSON.parse(opts.body) });
                const merged = u.endsWith('/merge');
                return { ok: true, status: 200, json: async () => ({ sub_sections: merged ? [{ ...SUBS[0], name: 'Both', end_page: 60 }] : [TWO[1]] }) };
            }
            if (u.includes('/eval/ocr/scan-config')) return { ok: true, status: 200, json: async () => ({ ...CFG(true), sub_sections: TWO }) };
            return { ok: true, status: 200, json: async () => ({}) };
        });
        mockPdfDoc = { numPages: 300, getPage: async () => { throw new Error('no canvas in jsdom'); } };
        renderParser();
        fireEvent.click(await screen.findByRole('button', { name: 'Verify sub-sections (2)' }));
        const dialog = screen.getByRole('dialog', { name: 'Verify sub-sections' });

        fireEvent.click(within(dialog).getByLabelText('Select Prastavana'));
        fireEvent.click(within(dialog).getByLabelText('Select Second'));
        fireEvent.click(within(dialog).getByRole('button', { name: /^Merge \(2\)/ }));
        const ask = screen.getByRole('dialog', { name: 'Merge sub-sections' });
        fireEvent.change(within(ask).getByLabelText(/Name of the merged/), { target: { value: 'Both' } });
        fireEvent.click(within(ask).getByRole('button', { name: 'Merge' }));
        await waitFor(() => expect(posts).toHaveLength(1));
        expect(posts[0].url).toBe('merge');
        expect(posts[0].body.relative_path).toBe('Granth/hindi/Karananuyog/Lok Vibhag/LokVibhag.pdf');
        expect(posts[0].body.name).toBe('Both');
        expect(posts[0].body.items.map((i) => i.index)).toEqual([0, 1]);
        await waitFor(() => expect(within(dialog).getByTestId('rail')).toHaveTextContent('12–60'));
        expect(within(dialog).getByTestId('rail')).not.toHaveTextContent('Second');
    });
});
