import React from 'react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PDFParser from './PDFParser';

const { loadPDF, getPage } = vi.hoisted(() => ({ loadPDF: vi.fn(), getPage: vi.fn() }));
vi.mock('../../hooks/usePDFViewer', () => ({
    default: () => new Proxy({
        pdfDoc: { getPage }, currentPage: 16, totalPages: 21,
        previewUrl: null, croppedPreviewUrl: null, bookmarks: [], loadPDF,
    }, { get: (target, key) => key in target ? target[key] : () => {} }),
}));

beforeEach(() => {
    getPage.mockResolvedValue({
        getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
        render: () => ({ promise: Promise.resolve() }),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })));
    global.fetch = vi.fn(async (url) => {
        if (String(url).includes('/eval/file/proxy')) {
            return { ok: true, blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }) };
        }
        return { ok: true, json: async () => ({
            layout: { mode: 'two_column', split_percent: 49.6, warnings: [] },
            preview_image: 'annotated', ocr_json: { page_num: 16, regions: [{}, {}], lines: [] },
            paragraphs: [{ text: 'Extracted Gujarati text', paragraph_type: 'STANDARD_PROSE' }],
        }) };
    });
});

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

test('URL → Auto Tesseract → current-page paragraphs and annotated preview', async () => {
    render(<PDFParser />);
    fireEvent.change(screen.getByPlaceholderText('https://example.com/file.pdf'), {
        target: { value: 'https://example.com/A_048_04.pdf?path=uploads/issue.pdf' },
    });
    fireEvent.click(screen.getByTitle('Load'));
    await waitFor(() => expect(loadPDF).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Auto Tesseract' }));
    expect(screen.getByLabelText('Multi-page PDF')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Batch' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Process' }));
    expect(await screen.findByText('Extracted Gujarati text')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Two columns · split at 49.6%');
    const [, request] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/eval/ocr'));
    expect(request.body.get('auto_layout')).toBe('true');
    expect(request.body.get('page_number')).toBe('16');
    expect(request.body.get('use_default_scan_config')).toBe('false');
    expect(request.body.get('image').name).toBe('page_16.png');
    fireEvent.click(screen.getByRole('button', { name: 'OCR Preview' }));
    expect(screen.getByAltText('Preview')).toHaveAttribute('src', 'data:image/png;base64,annotated');
});

test('ambiguous layouts expose the backend review warning', async () => {
    global.fetch = vi.fn(async (url) => String(url).includes('/eval/file/proxy')
        ? { ok: true, blob: async () => new Blob(['png'], { type: 'image/png' }) }
        : { ok: true, json: async () => ({ layout: { mode: 'review', warnings: ['Table-like ruling detected.'] }, paragraphs: [] }) });
    render(<PDFParser />);
    fireEvent.change(screen.getByPlaceholderText('https://example.com/file.pdf'), { target: { value: 'https://example.com/page.png' } });
    fireEvent.click(screen.getByTitle('Load'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Process' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Auto Tesseract' }));
    fireEvent.click(screen.getByRole('button', { name: 'Process' }));
    expect(await screen.findByText('Table-like ruling detected.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Layout needs review');
});
