import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, within } from '@testing-library/react';
import EvalBar, { PRIMARY_TABS, MORE_TABS } from './EvalBar';

const PATHS = { base_pdf_path: '/data/configs', base_ocr_path: '/data/ocr', base_text_path: '/data/text' };
const setup = (props = {}) => {
    const handlers = { onTab: jest.fn(), onBrowse: jest.fn(), onToggleFocus: jest.fn() };
    render(<EvalBar activeTab="pdf-parser" fileLabel={null} canBrowse basePaths={PATHS} focus={false} {...handlers} {...props} />);
    return handlers;
};

test('the tool tabs are single-line labels, with the admin tools tucked under More', () => {
    setup();
    const tabs = within(screen.getByRole('navigation', { name: 'Eval tools' }));
    expect(PRIMARY_TABS.map((t) => t.label)).toEqual(['Home', 'PDF Parser', 'OCR Preview', 'Gen Eval', 'Classifier']);
    for (const t of PRIMARY_TABS) expect(tabs.getByRole('button', { name: t.label })).toBeInTheDocument();
    expect(tabs.queryByText('Load Test')).not.toBeInTheDocument();
    expect(tabs.getByRole('button', { name: /More/ })).toBeInTheDocument();
});

test('the active tool is marked, and clicking another reports it', () => {
    const { onTab } = setup({ activeTab: 'paragraph-eval' });
    expect(screen.getByRole('button', { name: 'Gen Eval' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'PDF Parser' })).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByRole('button', { name: 'Classifier' }));
    expect(onTab).toHaveBeenCalledWith('paragraph-classifier');
});

test('More lists the other tools, opens on click, and picking one closes it', () => {
    const { onTab } = setup();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(MORE_TABS.map((t) => t.label));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Bookmark Backfill' }));
    expect(onTab).toHaveBeenCalledWith('bookmark-backfill');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('when a tool from More is open, the More tab shows its name and is highlighted', () => {
    setup({ activeTab: 'load-test' });
    expect(screen.getByRole('button', { name: /Load Test/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^More/ })).not.toBeInTheDocument();
});

test('the menu closes on Escape and on an outside click', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('the file chip shows the open file (or invites you to browse) and opens the file browser', () => {
    const { onBrowse } = setup({ fileLabel: 'Aaradhansar.pdf' });
    const chip = screen.getByTestId('file-chip');
    expect(chip).toHaveTextContent('Aaradhansar.pdf');
    fireEvent.click(chip);
    expect(onBrowse).toHaveBeenCalled();
});

test('with no file yet the chip says how to pick one; tools that take no file have no chip', () => {
    const { unmount } = render(<EvalBar activeTab="pdf-parser" canBrowse basePaths={PATHS} onTab={() => {}} onBrowse={() => {}} onToggleFocus={() => {}} />);
    expect(screen.getByTestId('file-chip')).toHaveTextContent('Browse files…');
    unmount();
    setup({ activeTab: 'load-test', canBrowse: false });
    expect(screen.queryByTestId('file-chip')).not.toBeInTheDocument();
});

test('the three paths live behind an ⓘ popover instead of taking space all the time', () => {
    setup();
    expect(screen.queryByText('/data/configs')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Paths' }));
    const dialog = screen.getByRole('dialog', { name: 'Paths' });
    expect(within(dialog).getByText('/data/configs')).toBeInTheDocument();
    expect(within(dialog).getByText('/data/ocr')).toBeInTheDocument();
    expect(within(dialog).getByText('/data/text')).toBeInTheDocument();
    expect(dialog).toHaveAttribute('data-esc-owner');                       // Esc closes it before it would leave full screen
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('no paths button until the paths are known', () => {
    setup({ basePaths: null });
    expect(screen.queryByRole('button', { name: 'Paths' })).not.toBeInTheDocument();
});

test('the persistent Full screen button toggles, and says what it will do', () => {
    const { onToggleFocus } = setup({ focus: false });
    fireEvent.click(screen.getByRole('button', { name: /Full screen/ }));
    expect(onToggleFocus).toHaveBeenCalledTimes(1);
});

test('in full screen the same button reads Exit and is pressed', () => {
    setup({ focus: true });
    const button = screen.getByRole('button', { name: /Exit full screen/ });
    expect(button).toHaveAttribute('aria-pressed', 'true');
});
