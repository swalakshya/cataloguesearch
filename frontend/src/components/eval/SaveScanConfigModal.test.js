import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SaveScanConfigModal from './SaveScanConfigModal';

const API = 'http://api.test';
const RAW_OK = { kind: 'scan_config', file: 'Granth/scan_config.json', exists: true, editable: true, reason: '', text: '{}', hash: 'h1' };
const VALUES = { crop: { top: 6, bottom: 4, left: 0, right: 0 }, language: 'hi', ocr_engine: 'llm', multi_page: false, llm_model: 'gemini-2.5-flash' };
const CHANGES = [
    { label: 'Crop', before: 'T9 B4 L0 R0', after: 'T6 B4 L0 R0', changed: true },
    { label: 'Language', before: 'Hindi', after: 'Hindi', changed: false },
];

const mockFetch = (getBody, postFn) => {
    global.fetch = jest.fn(async (url, opts) => {
        const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
        if (opts?.method === 'POST') return postFn ? postFn(JSON.parse(opts.body)) : ok({ entry: {}, hash: 'h2' });
        return typeof getBody === 'function' ? getBody() : ok(getBody);
    });
};

const props = (extra = {}) => ({
    apiBaseUrl: API, relativePath: 'Granth/hindi/Book.pdf', values: VALUES, removeKeys: ['split_percentage'],
    changes: CHANGES, onClose: jest.fn(), onSaved: jest.fn(), ...extra,
});

afterEach(() => jest.restoreAllMocks());

test('shows the file and the before/after for every control, unchanged rows plain', async () => {
    mockFetch(RAW_OK);
    render(<SaveScanConfigModal {...props()} />);
    expect(await screen.findByText('Granth/scan_config.json')).toBeInTheDocument();
    const table = screen.getByTestId('changes-table');
    expect(within(table).getByTestId('row-Crop')).toHaveTextContent('T9 B4 L0 R0');
    expect(within(table).getByTestId('row-Crop')).toHaveTextContent('T6 B4 L0 R0');
    expect(within(table).getByTestId('row-Crop')).toHaveAttribute('data-changed', 'true');
    expect(within(table).getByTestId('row-Language')).toHaveAttribute('data-changed', 'false');
});

test('nothing-changed note appears only when every row is unchanged', async () => {
    mockFetch(RAW_OK);
    render(<SaveScanConfigModal {...props({ changes: [{ label: 'Crop', before: 'T0', after: 'T0', changed: false }] })} />);
    expect(await screen.findByText(/Nothing has changed/)).toBeInTheDocument();
    render(<SaveScanConfigModal {...props()} />);
    await screen.findByText('Granth/scan_config.json');
    expect(screen.queryAllByText(/Nothing has changed/)).toHaveLength(1); // still just the first instance
});

test('Save posts the values, removeKeys and the loaded hash, then shows Saved', async () => {
    let sent;
    mockFetch(RAW_OK, (body) => { sent = body; return { ok: true, status: 200, json: async () => ({ entry: { language: 'hi' }, hash: 'h2' }) }; });
    const onSaved = jest.fn();
    render(<SaveScanConfigModal {...props({ onSaved })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent).toEqual({
        relative_path: 'Granth/hindi/Book.pdf', values: VALUES, remove_keys: ['split_percentage'], expected_hash: 'h1',
    }));
    expect(await screen.findByTestId('saved-note')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ entry: { language: 'hi' } }));
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull(); // can't double-save
});

test('a refused save (stale hash) shows the reason and the dialog stays open', async () => {
    mockFetch(RAW_OK, () => ({ ok: false, status: 409, json: async () => ({ detail: 'The file changed on disk since you opened it. Reopen it to see the latest version.' }) }));
    render(<SaveScanConfigModal {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/changed on disk/)).toBeInTheDocument();
    expect(screen.queryByTestId('saved-note')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
});

test('read-only (not in the configs repo) has no Save button', async () => {
    mockFetch({ ...RAW_OK, editable: false, reason: 'Read-only: this file is not in the configs repo.' });
    render(<SaveScanConfigModal {...props()} />);
    expect(await screen.findByTestId('read-only-notice')).toHaveTextContent('not in the configs repo');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});

test('a load failure offers Retry and blocks Save until it succeeds', async () => {
    mockFetch(() => ({ ok: false, status: 500, json: async () => ({ detail: 'disk error' }) }));
    render(<SaveScanConfigModal {...props()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('disk error');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    mockFetch(RAW_OK);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
});

test('Cancel and Escape both close without saving', async () => {
    mockFetch(RAW_OK);
    const onClose = jest.fn();
    render(<SaveScanConfigModal {...props({ onClose })} />);
    await screen.findByRole('button', { name: 'Save' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(1); // only the initial GET
});

test('owns Escape (data-esc-owner), same as the other popups', async () => {
    mockFetch(RAW_OK);
    render(<SaveScanConfigModal {...props()} />);
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-esc-owner');
});
