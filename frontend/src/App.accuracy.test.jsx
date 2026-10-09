import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import App from './App';

const apiMock = vi.hoisted(() => ({ getAppConfig: vi.fn(), getAuthors: vi.fn(), getMetadata: vi.fn(), checkLlmHealth: vi.fn(), search: vi.fn() }));
vi.mock('./services/api', () => ({ api: apiMock }));
vi.mock('./auth/AuthContext', () => ({ useAuth: () => ({ user: null, settings: null, loading: false }) }));
vi.mock('./theme/ThemeContext', () => ({ useTheme: () => ({ setMode: () => {}, setPalette: () => {} }),
    getInitialMode: () => 'light', getInitialPalette: () => 'sand', getSystemDefaultMode: () => 'light' }));
vi.mock('./components/layout/Sidebar', () => ({ default: () => null }));
vi.mock('./components/layout/TopBar', () => ({ default: () => null }));
vi.mock('./components/layout/Footer', () => ({ default: () => null }));
vi.mock('./components/chat/StatsStrip', () => ({ default: () => null }));
vi.mock('./components/settings/SettingsModal', () => ({ default: () => null }));
vi.mock('./components/SearchInterface', () => ({
    SearchBar: ({ query, setQuery }) => <input aria-label="Search query" value={query} onChange={e => setQuery(e.target.value)} />,
    MetadataFilters: () => null, SearchFilters: () => null, AdvancedSearch: () => null, SearchOptions: () => null,
}));

beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks();
    localStorage.setItem('aagamKhojHasVisited', 'true'); localStorage.setItem('signUpPromptDismissed', '1');
    window.history.replaceState({}, '', '/aagam-khoj');
    apiMock.getAppConfig.mockResolvedValue({ active_categories: ['Granth'] });
    apiMock.getAuthors.mockResolvedValue({}); apiMock.getMetadata.mockResolvedValue({});
    apiMock.checkLlmHealth.mockResolvedValue(false); apiMock.search.mockResolvedValue(null);
});
afterEach(cleanup);

it('sends the currently selected Khoj mode and can switch back to Low', async () => {
    render(<App />);
    await waitFor(() => expect(apiMock.getAppConfig).toHaveBeenCalled());
    expect(screen.getByLabelText('Search query').closest('.rounded-xl')
        .contains(screen.getByRole('button', { name: 'Search effort' }))).toBe(true);
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'आत्मा का स्वरूप क्या है?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search effort' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Search effort level' }), { target: { value: '1' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }));
    await waitFor(() => expect(apiMock.search).toHaveBeenCalledTimes(1));
    expect(apiMock.search.mock.calls[0][0].accuracy_mode).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Search effort' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Search effort' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Search effort level' }), { target: { value: '0' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }));
    await waitFor(() => expect(apiMock.search).toHaveBeenCalledTimes(2));
    expect(apiMock.search.mock.calls[1][0].accuracy_mode).toBe(false);
});

it('renders the shared search total without a breakdown', async () => {
    apiMock.search.mockResolvedValue({ timings: { total_ms: 18400, operations: { context: 800, reranking: 15100 } } });
    render(<App />);
    await waitFor(() => expect(apiMock.getAppConfig).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'विकल्प और विचार' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }));
    expect(await screen.findByText('Searched in 18.4s')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Searched in/ })).toBeNull();
    expect(screen.queryByText('Surrounding context')).toBeNull();
});
