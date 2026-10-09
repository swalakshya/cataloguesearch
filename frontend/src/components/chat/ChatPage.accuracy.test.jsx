import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import ChatPage from './ChatPage';

const apiMock = vi.hoisted(() => ({ createChatSession: vi.fn(), submitChatMessage: vi.fn(), streamChatMessageResult: vi.fn() }));
vi.mock('../../services/api', () => ({ api: apiMock }));
vi.mock('../SearchInterface', () => ({ SearchBar: ({ query, setQuery }) =>
    <input aria-label="Question" value={query} onChange={e => setQuery(e.target.value)} /> }));
vi.mock('./StatsStrip', () => ({ default: () => null }));
vi.mock('./PdfCitationModal', () => ({ default: () => null }));

beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks();
    apiMock.createChatSession.mockResolvedValue({ session_id: 'session' });
    apiMock.submitChatMessage.mockResolvedValue({ message_id: 'message' });
    apiMock.streamChatMessageResult.mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    Element.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

for (const [defaultAccuracy, selected, expected] of [[true, null, true], [false, 'accuracy', true], [true, 'standard', false]]) {
    it(`sends accuracy=${expected} using saved default ${defaultAccuracy} and composer override ${selected}`, async () => {
        render(<MemoryRouter><ChatPage language="hindi" appName="swalakshya" activeCategories={['Granth']}
            activeFilters={[]} query="आत्मा का स्वरूप क्या है?" setQuery={() => {}}
            answerFormat="summary" chatDefaultAccuracyMode={defaultAccuracy} /></MemoryRouter>);
        if (selected) {
            fireEvent.click(screen.getByRole('button', { name: 'Search effort' }));
            fireEvent.change(screen.getByRole('slider', { name: 'Search effort level' }), { target: { value: selected === 'accuracy' ? '1' : '0' } });
            fireEvent.keyDown(document, { key: 'Escape' });
        }
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await waitFor(() => expect(apiMock.submitChatMessage).toHaveBeenCalled());
        expect(apiMock.submitChatMessage.mock.calls[0][1].accuracy_mode).toBe(expected);
    });
}

it('renders completed chat timings through the shared component', async () => {
    apiMock.streamChatMessageResult.mockResolvedValue({ answer: 'उत्तर', timings: { total_ms: 32600, operations: { searching: 18400, preparing: 12700 } } });
    render(<MemoryRouter><ChatPage language="hindi" appName="swalakshya" activeCategories={['Granth']}
        activeFilters={[]} query="विकल्प और विचार" setQuery={() => {}} answerFormat="summary" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const timing = await screen.findByRole('button', { name: /Completed in 32.6s/ });
    expect(timing).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(timing);
    expect(screen.getByText('Generating answer')).toBeTruthy();
});
