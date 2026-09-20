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
