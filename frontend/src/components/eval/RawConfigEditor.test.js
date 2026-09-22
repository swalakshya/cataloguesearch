import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RawConfigEditor from './RawConfigEditor';

const API = 'http://api.test';
const GET_OK = { kind: 'config', file: 'Granth/config.json', exists: true, editable: true, reason: '', text: '{\n  "a": 1\n}', hash: 'h1' };

const mockFetch = (getBody, postFn) => {
    global.fetch = jest.fn(async (url, opts) => {
        const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
        if (opts?.method === 'POST') return postFn ? postFn(JSON.parse(opts.body)) : ok({ ...GET_OK, hash: 'h2' });
        return typeof getBody === 'function' ? getBody() : ok(getBody);
    });
};

const props = (extra = {}) => ({ apiBaseUrl: API, relativePath: 'Granth/Book.pdf', kind: 'config', onClose: jest.fn(), onSaved: jest.fn(), ...extra });

afterEach(() => jest.restoreAllMocks());

test('loads and shows the file text, requesting the right kind and path', async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => GET_OK }));
    render(<RawConfigEditor {...props()} />);
    expect(await screen.findByRole('textbox', { name: 'config.json contents' })).toHaveValue('{\n  "a": 1\n}');
    expect(global.fetch).toHaveBeenCalledWith(`${API}/eval/ocr/raw-config?relative_path=Granth%2FBook.pdf&kind=config`);
    expect(screen.getByText('Granth/config.json')).toBeInTheDocument();
});

test('a load failure shows the reason and offers Retry', async () => {
    mockFetch(() => ({ ok: false, status: 500, json: async () => ({ detail: 'disk error' }) }));
    render(<RawConfigEditor {...props()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('disk error');
    mockFetch(GET_OK);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('textbox')).toHaveValue(GET_OK.text);
});

test('a file that does not exist yet starts from an empty object and says so', async () => {
    mockFetch({ ...GET_OK, exists: false, text: '{}\n' });
    render(<RawConfigEditor {...props()} />);
    expect(await screen.findByText(/does not exist yet/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('{}\n');
});

test('invalid JSON is flagged and Save is disabled, without a request being made', async () => {
    mockFetch(GET_OK);
    render(<RawConfigEditor {...props()} />);
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: '{not json' } });
    expect(await screen.findByTestId('json-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(global.fetch).toHaveBeenCalledTimes(1); // only the initial GET
});

test('a JSON array or bare value is rejected the same as a syntax error', async () => {
    mockFetch(GET_OK);
    render(<RawConfigEditor {...props()} />);
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: '[1, 2, 3]' } });
    expect(await screen.findByTestId('json-error')).toHaveTextContent('must be a JSON object');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('Save sends the edited text and the hash it was loaded with, then shows Saved', async () => {
    let sent;
    mockFetch(GET_OK, (body) => { sent = body; return { ok: true, status: 200, json: async () => ({ ...GET_OK, text: body.text, hash: 'h2' }) }; });
    const onSaved = jest.fn();
    render(<RawConfigEditor {...props({ onSaved })} />);
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: '{\n  "a": 2\n}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent).toEqual({ relative_path: 'Granth/Book.pdf', kind: 'config', text: '{\n  "a": 2\n}', expected_hash: 'h1' }));
    expect(await screen.findByTestId('saved-note')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ hash: 'h2' }));
});

test('a refused save (e.g. the file changed on disk) shows the server reason and keeps your edit', async () => {
    mockFetch(GET_OK, () => ({ ok: false, status: 409, json: async () => ({ detail: 'The file changed on disk since you opened it. Reopen it to see the latest version.' }) }));
    render(<RawConfigEditor {...props()} />);
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: '{\n  "a": 3\n}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/changed on disk/)).toBeInTheDocument();
    expect(box).toHaveValue('{\n  "a": 3\n}');
    expect(screen.queryByTestId('saved-note')).toBeNull();
});

test('a read-only file (not in the configs repo) has no Save button and the textarea is read-only', async () => {
    mockFetch({ ...GET_OK, editable: false, reason: 'Read-only: this file is not in the configs repo.' });
    render(<RawConfigEditor {...props()} />);
    expect(await screen.findByTestId('read-only-notice')).toHaveTextContent('not in the configs repo');
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});

test('Close and Escape both call onClose without saving', async () => {
    mockFetch(GET_OK);
    const onClose = jest.fn();
    render(<RawConfigEditor {...props({ onClose })} />);
    await screen.findByRole('textbox');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(1); // never posted
});

test('the dialog owns Escape (data-esc-owner), same as the other popups', async () => {
    mockFetch(GET_OK);
    render(<RawConfigEditor {...props()} />);
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-esc-owner');
});

test('the scan_config.json kind is requested and labelled correctly', async () => {
    mockFetch({ ...GET_OK, kind: 'scan_config', file: 'Granth/scan_config.json', text: '{}' });
    render(<RawConfigEditor {...props({ kind: 'scan_config' })} />);
    await screen.findByRole('textbox', { name: 'scan_config.json contents' });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('kind=scan_config'));
    expect(screen.getByRole('heading', { name: 'scan_config.json' })).toBeInTheDocument();
});
