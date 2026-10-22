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
    localStorage.setItem('default_categories_khoj', JSON.stringify(['Granth']));
    window.history.replaceState({}, '', '/aagam-khoj');
    apiMock.getAppConfig.mockResolvedValue({ active_categories: ['Pravachan', 'Granth', 'Books'] });
    apiMock.getAuthors.mockResolvedValue({ Granth: { hindi: ['Acharya Amritchandra'] }, Books: { hindi: ['Shri Lalchandbhai Modi'] } });
    apiMock.getMetadata.mockResolvedValue({
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

it('enables both author categories despite Books defaulting off, narrows both pickers, and searches both', async () => {
    render(<App />);
    await waitFor(() => expect(apiMock.getCatalogue).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /^Books/ }).disabled).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /^Author/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Acharya Amritchandra' }));
    fireEvent.click(screen.getByRole('tab', { name: /Contemporary/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shri Lalchandbhai Modi' }));
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
    expect(screen.getByRole('button', { name: /^Books/ }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /^Granth/ }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /^Pravachan/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Granth/ }));
    expect(screen.getByRole('checkbox', { name: 'Selected granth' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Unrelated granth' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /^Books/ }));
    expect(screen.getByRole('checkbox', { name: 'Selected book' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Unrelated book' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.change(screen.getByPlaceholderText('Enter your search query...'), { target: { value: 'आत्मा' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }));
    await waitFor(() => expect(apiMock.search).toHaveBeenCalledTimes(1));
    const payload = apiMock.search.mock.calls[0][0];
    expect(payload.search_types.Books.enabled).toBe(true);
    expect(payload.search_types.Granth.enabled).toBe(true);
    expect(payload.search_types.Pravachan.enabled).toBe(false);
    expect(payload.categories).toEqual({ _granth_authors: ['Acharya Amritchandra'], _books_authors: ['Shri Lalchandbhai Modi'] });
});
