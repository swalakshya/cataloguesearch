import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import SettingsModal from './SettingsModal';

const mocks = vi.hoisted(() => ({ auth: { user: null, refreshSettings: vi.fn() }, updateSettings: vi.fn() }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../services/api', () => ({ api: { updateSettings: mocks.updateSettings } }));
vi.mock('../../theme/ThemeContext', () => ({
    useTheme: () => ({ mode: 'light', palette: 'sand', setMode: () => {}, setPalette: () => {} }),
    setStoredMode: () => {}, setStoredPalette: () => {},
}));
vi.mock('../ui', () => ({ Modal: ({ open, children, footer }) => open ? <div>{children}{footer}</div> : null }));

beforeEach(() => { localStorage.clear(); mocks.auth.user = null; vi.clearAllMocks(); });
afterEach(cleanup);
const props = { open: true, onClose: vi.fn(), answerFormat: 'summary', onSaveAnswerFormat: vi.fn(),
    activeCategories: ['Granth'], chatDefaultCategories: ['Granth'], khojDefaultCategories: ['Granth'] };

it('keeps accuracy as a draft until Save and persists the anonymous default', () => {
    const save = vi.fn();
    render(<SettingsModal {...props} onSaveChatAccuracyMode={save} />);
    fireEvent.click(screen.getByRole('radio', { name: 'High' }));
    expect(save).not.toHaveBeenCalled();
    expect(localStorage.getItem('default_accuracy_chat')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(true);
    expect(localStorage.getItem('default_accuracy_chat')).toBe('true');
    expect(props.onSaveAnswerFormat).not.toHaveBeenCalled();
});

it('saves accuracy with the account settings without writing anonymous storage', async () => {
    mocks.auth.user = { id: 'user' };
    mocks.updateSettings.mockResolvedValue({ settings: { chatAccuracyMode: true } });
    render(<SettingsModal {...props} chatAccuracyMode />);
    expect(screen.getByRole('radio', { name: 'High' }).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ chatAccuracyMode: true }));
    await waitFor(() => expect(mocks.auth.refreshSettings).toHaveBeenCalledWith({ chatAccuracyMode: true }));
    expect(localStorage.getItem('default_accuracy_chat')).toBeNull();
});

it('discards an unsaved accuracy draft when reopened', () => {
    const { rerender } = render(<SettingsModal {...props} />);
    fireEvent.click(screen.getByRole('radio', { name: 'High' }));
    rerender(<SettingsModal {...props} open={false} />);
    rerender(<SettingsModal {...props} />);
    expect(screen.getByRole('radio', { name: 'Low' }).checked).toBe(true);
});
