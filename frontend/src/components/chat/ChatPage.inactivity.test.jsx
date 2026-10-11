import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render as renderComponent, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import ChatPage from './ChatPage';
const render = element => renderComponent(<MemoryRouter>{element}</MemoryRouter>);
const apiMock = vi.hoisted(() => ({ getChatSession: vi.fn(), createChatSession: vi.fn(), submitChatMessage: vi.fn(), streamChatMessageResult: vi.fn() }));
vi.mock('../../services/api', () => ({ api: apiMock }));
vi.mock('./ChatComposer', () => ({ default: ({ query, setQuery, onSend }) => <><input aria-label="Question" value={query} onChange={e => setQuery(e.target.value)} /><button onClick={onSend}>Send</button></> }));
vi.mock('./StatsStrip', () => ({ default: () => null }));
vi.mock('./PdfCitationModal', () => ({ default: () => null }));
const messages = [{ role: 'user', content: 'Old conversation' }];
const props = { language: 'hindi', appName: 'swalakshya', activeCategories: ['Granth'], activeFilters: [], query: '', setQuery: () => {}, answerFormat: 'summary', authenticatedUserId: 'owner' };
const old = { session_id: 'old', messages, read_only: true, inactivity_remaining_ms: 0 };
beforeEach(() => {
    vi.resetAllMocks(); localStorage.clear();
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    Element.prototype.scrollIntoView = () => {};
    apiMock.getChatSession.mockResolvedValue(old);
    apiMock.createChatSession.mockResolvedValue({ session_id: 'fresh' });
    apiMock.submitChatMessage.mockResolvedValue({ message_id: 'message' });
    apiMock.streamChatMessageResult.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const save = () => localStorage.setItem('llmChatSession', JSON.stringify({ sessionId: 'old', messages }));
it('opens an empty chat after inactivity without deleting history', async () => {
    save(); render(<ChatPage {...props} />);
    await screen.findByText(/48 hours/);
    expect(screen.queryByText('Old conversation')).toBeNull();
    expect(localStorage.getItem('llmChatSession')).toBeNull();
    expect(apiMock.createChatSession).not.toHaveBeenCalled();
});
it('keeps inactive History readable and sends the next question in a fresh chat', async () => {
    render(<ChatPage {...props} remoteSessionId="old" />);
    await screen.findByText('Old conversation'); await screen.findByText(/read-only/);
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'New question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiMock.submitChatMessage).toHaveBeenCalledWith('fresh', expect.objectContaining({ content: 'New question' })));
    expect(screen.queryByText('Old conversation')).toBeNull();
});
it('leaves anonymous conversations alone', async () => {
    save(); render(<ChatPage {...props} authenticatedUserId={null} />);
    await screen.findByText('Old conversation'); expect(apiMock.getChatSession).not.toHaveBeenCalled();
});
it('rechecks activity when the tab becomes visible', async () => {
    save(); apiMock.getChatSession.mockResolvedValue({ ...old, read_only: false, inactivity_remaining_ms: 100_000 });
    render(<ChatPage {...props} />);
    await waitFor(() => expect(apiMock.getChatSession).toHaveBeenCalledWith('old'));
    apiMock.getChatSession.mockResolvedValue(old);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByText(/48 hours/); expect(screen.queryByText('Old conversation')).toBeNull();
});
it('checks the server deadline while the page stays open', async () => {
    vi.useFakeTimers(); save();
    apiMock.getChatSession.mockResolvedValue({ ...old, read_only: false, inactivity_remaining_ms: 1000 });
    render(<ChatPage {...props} />); await act(async () => {});
    apiMock.getChatSession.mockResolvedValue(old);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText(/48 hours/)).toBeTruthy(); expect(screen.queryByText('Old conversation')).toBeNull();
});
it('retries in a new chat if inactivity races with sending', async () => {
    save(); apiMock.getChatSession.mockResolvedValue({ ...old, read_only: false, inactivity_remaining_ms: 100_000 });
    apiMock.submitChatMessage.mockRejectedValueOnce(Object.assign(new Error('session_inactive'), { status: 409, detail: 'session_inactive' }));
    render(<ChatPage {...props} />); await screen.findByText('Old conversation');
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Racing question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiMock.submitChatMessage).toHaveBeenCalledWith('fresh', expect.objectContaining({ content: 'Racing question' })));
});
it('does not discard a chat when the activity check fails', async () => {
    save(); apiMock.getChatSession.mockRejectedValue(new Error('offline'));
    render(<ChatPage {...props} />);
    await waitFor(() => expect(apiMock.getChatSession).toHaveBeenCalled());
    expect(screen.getByText('Old conversation')).toBeTruthy();
    expect(localStorage.getItem('llmChatSession')).not.toBeNull();
});
it('does not reset while the server is processing an answer', async () => {
    save(); apiMock.getChatSession.mockResolvedValue({ ...old, busy: true });
    render(<ChatPage {...props} />);
    await waitFor(() => expect(apiMock.getChatSession).toHaveBeenCalled());
    expect(screen.getByText('Old conversation')).toBeTruthy();
    expect(screen.queryByText(/48 hours/)).toBeNull();
});
it('ignores a stale inactivity response after navigating to a different session', async () => {
    let finishOld;
    save(); apiMock.getChatSession.mockImplementation(id => id === 'old'
        ? new Promise(resolve => { finishOld = resolve; })
        : Promise.resolve({ session_id: 'recent', messages: [{ role: 'user', content: 'Recent conversation' }], read_only: false, inactivity_remaining_ms: 100_000 }));
    const view = render(<ChatPage {...props} />);
    await waitFor(() => expect(finishOld).toBeTypeOf('function'));
    view.rerender(<MemoryRouter><ChatPage {...props} remoteSessionId="recent" /></MemoryRouter>);
    await screen.findByText('Recent conversation');
    await act(async () => { finishOld(old); });
    expect(screen.getByText('Recent conversation')).toBeTruthy();
    expect(screen.queryByText(/48 hours/)).toBeNull();
});
it('uses renewed server activity from another device at the old deadline', async () => {
    vi.useFakeTimers(); save();
    apiMock.getChatSession.mockResolvedValue({ ...old, read_only: false, inactivity_remaining_ms: 1000 });
    render(<ChatPage {...props} />); await act(async () => {});
    apiMock.getChatSession.mockResolvedValue({ ...old, read_only: false, inactivity_remaining_ms: 100_000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText('Old conversation')).toBeTruthy();
    expect(screen.queryByText(/48 hours/)).toBeNull();
});
it('lets the question be retried if creating the replacement session fails', async () => {
    save(); apiMock.getChatSession.mockResolvedValue({ ...old, read_only: false, inactivity_remaining_ms: 100_000 });
    apiMock.submitChatMessage.mockRejectedValueOnce(Object.assign(new Error('session_inactive'), { status: 409, detail: 'session_inactive' }));
    apiMock.createChatSession.mockRejectedValueOnce(new Error('offline'));
    render(<ChatPage {...props} />); await screen.findByText('Old conversation');
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Keep my question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Could not start a new chat. Please try again.');
    expect(screen.getByLabelText('Question').value).toBe('Keep my question');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiMock.submitChatMessage).toHaveBeenCalledWith('fresh', expect.objectContaining({ content: 'Keep my question' })));
    expect(apiMock.submitChatMessage.mock.calls.some(([id]) => id == null)).toBe(false);
});
