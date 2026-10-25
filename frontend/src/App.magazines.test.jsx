import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import App from './App';

const apiMock = vi.hoisted(() => ({ getCatalogue: vi.fn(), getAppConfig: vi.fn(), getAuthors: vi.fn(), getMetadata: vi.fn(), checkLlmHealth: vi.fn(), search: vi.fn() }));
vi.mock('./services/api', () => ({ api: apiMock }));
vi.mock('./auth/AuthContext', () => ({ useAuth: () => ({ user: null, settings: null, loading: false }) }));
vi.mock('./theme/ThemeContext', () => ({ useTheme: () => ({ setMode: () => {}, setPalette: () => {} }),
    getInitialMode: () => 'light', getInitialPalette: () => 'sand', getSystemDefaultMode: () => 'light' }));
vi.mock('./components/layout/Sidebar', () => ({ default: () => null }));
vi.mock('./components/layout/TopBar', () => ({ default: () => null }));
vi.mock('./components/layout/Footer', () => ({ default: () => null }));
vi.mock('./components/chat/StatsStrip', () => ({ default: () => null }));
vi.mock('./components/settings/SettingsModal', () => ({ default: () => null }));

beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks();
    localStorage.setItem('aagamKhojHasVisited', 'true');
    localStorage.setItem('signUpPromptDismissed', '1');
    window.history.replaceState({}, '', '/aagam-khoj');
    apiMock.getAppConfig.mockResolvedValue({ active_categories: ['Pravachan', 'Granth', 'Books', 'Magazine'] });
    apiMock.getAuthors.mockResolvedValue({ Granth: { hindi: ['Acharya Amritchandra'] }, Books: { hindi: ['Shri Lalchandbhai Modi'] } });
    apiMock.getMetadata.mockResolvedValue({
        Magazine: { hindi: { Name: ['Atmadharma'] }, gujarati: { Name: ['આત્મધર્મ'] } },
        Granth: { hindi: { Name: ['Selected granth', 'Unrelated granth'] } },
        Books: { hindi: { Name: ['Selected book', 'Unrelated book'] } },
    });
    apiMock.getCatalogue.mockResolvedValue([
        { category: 'Granth', language: 'hi', author: 'Acharya Amritchandra', granth: 'Selected granth' },
        { category: 'Books', language: 'hi', author: 'Shri Lalchandbhai Modi', granth: 'Selected book' },
    ]);
    apiMock.checkLlmHealth.mockResolvedValue(false); apiMock.search.mockResolvedValue(null);
});
afterEach(cleanup);


it('includes Magazine in new defaults and narrows a magazine selection to that category', async () => {
    render(<App />);
    const picker = await screen.findByRole('button', { name: /^Magazine/ });
    await waitFor(() => expect(picker.disabled).toBe(false));
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Atmadharma' }));
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
    fireEvent.change(screen.getByPlaceholderText('Enter your search query...'), { target: { value: 'आत्मा' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }));
    await waitFor(() => expect(apiMock.search).toHaveBeenCalledTimes(1));
    const payload = apiMock.search.mock.calls[0][0];
    expect(payload.search_types.Magazine.enabled).toBe(true);
    expect(payload.search_types.Magazine.page_number).toBe(1);
    expect(payload.search_types.Books.enabled).toBe(false);
    expect(payload.search_types.Granth.enabled).toBe(false);
    expect(payload.search_types.Pravachan.enabled).toBe(false);
    expect(payload.categories.Name).toEqual(['Atmadharma']);
});

it('preserves saved category defaults that exclude Magazine', async () => {
    localStorage.setItem('default_categories_khoj', JSON.stringify(['Granth']));
    render(<App />);
    const picker = await screen.findByRole('button', { name: /^Magazine/ });
    await waitFor(() => expect(picker.disabled).toBe(true));
});

it('paginates Magazine results with the requested page rather than stale state', async () => {
    const empty = { results: [], total_hits: 0 };
    apiMock.search.mockResolvedValue({ pravachan_results: empty, granth_results: empty, books_results: empty,
        magazine_results: { results: [{ document_id: 'issue', content_snippet: 'Magazine evidence',
            metadata: { Name: 'Atmadharma', category: 'Magazine', metadata: { ank: '42' } } }], total_hits: 45 } });
    render(<App />);
    await screen.findByRole('button', { name: /^Magazine/ });
    fireEvent.change(screen.getByPlaceholderText('Enter your search query...'), { target: { value: 'आत्मा' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: '2', exact: true }));
    await waitFor(() => expect(apiMock.search).toHaveBeenCalledTimes(2));
    expect(apiMock.search.mock.calls[1][0].search_types.Magazine.page_number).toBe(2);
});
