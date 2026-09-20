import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import SubSectionVerifier, { pickRandom, neighbours } from './SubSectionVerifier';

const SUBS = [
    { field: 'Adhikaar', name: 'Prastavana', start_page: 12, end_page: 39 },
    { field: 'Adhikaar', name: 'Pratham Vibhag - Jambudvip', start_page: 56, end_page: 102 },
    { field: 'Adhikaar', name: 'Dwitiya Vibhag - Lavan Samudra', start_page: 103, end_page: 114 },
    { field: 'Adhikaar', name: 'Ekadash Vibhag - Moksh', start_page: 273, end_page: 280 },
];
const many = (n) => Array.from({ length: n }, (_, i) => ({ field: 'F', name: `Section ${i + 1}`, start_page: i * 10 + 1, end_page: i * 10 + 9 }));

const setup = (props = {}) => {
    const renderPageImage = jest.fn(async (_doc, page) => `data:image/png;base64,PAGE${page}`);
    const onClose = jest.fn();
    render(<SubSectionVerifier pdfDoc={{ numPages: 300 }} subSections={SUBS} crop={{ top: 9, bottom: 4 }} multiPage={false}
        fileName="LokVibhag.pdf" onClose={onClose} renderPageImage={renderPageImage} {...props} />);
    return { renderPageImage, onClose };
};
const label = () => screen.getByTestId('section-label').textContent;
const pos = () => screen.getByTestId('position').textContent;
const key = (k) => fireEvent.keyDown(window, { key: k });

test('shows the start and end page of the first sub-section side by side', async () => {
    const { renderPageImage } = setup();
    expect(await screen.findByAltText('Start page 12')).toBeInTheDocument();
    expect(await screen.findByAltText('End page 39')).toBeInTheDocument();
    expect(label()).toBe('Adhikaar · Prastavana');
    expect(screen.getByText(/pages 12–39 \(28 pages\)/)).toBeInTheDocument();
    expect(renderPageImage.mock.calls.map(([, p]) => p)).toEqual(expect.arrayContaining([12, 39]));
});

test('arrow keys step through the sub-sections, and stop at both ends', async () => {
    setup();
    await screen.findByAltText('End page 39');
    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled();
    key('ArrowRight');
    expect(label()).toBe('Adhikaar · Pratham Vibhag - Jambudvip');
    expect(await screen.findByAltText('Start page 56')).toBeInTheDocument();
    expect(await screen.findByAltText('End page 102')).toBeInTheDocument();
    key('ArrowRight'); key('ArrowRight');
    expect(label()).toBe('Adhikaar · Ekadash Vibhag - Moksh');
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    key('ArrowRight');                                   // already at the end
    expect(label()).toBe('Adhikaar · Ekadash Vibhag - Moksh');
    key('ArrowLeft');
    expect(label()).toBe('Adhikaar · Dwitiya Vibhag - Lavan Samudra');
    expect(pos()).toBe('3 of 4');
});

test('arrow keys belong to the filter box while it has focus; Escape closes', () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByPlaceholderText(/Filter/), { key: 'ArrowRight', bubbles: true });
    expect(label()).toBe('Adhikaar · Prastavana');
    key('Escape');
    expect(onClose).toHaveBeenCalled();
});

test('clicking a row jumps to that sub-section', async () => {
    setup();
    fireEvent.click(screen.getByText('Ekadash Vibhag - Moksh'));
    expect(label()).toBe('Adhikaar · Ekadash Vibhag - Moksh');
    expect(await screen.findByAltText('Start page 273')).toBeInTheDocument();
});

test('"Selected" steps through only the ticked sub-sections', async () => {
    setup();
    const selectedChip = screen.getByRole('button', { name: /Selected/ });
    expect(selectedChip).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Select Prastavana'));
    fireEvent.click(screen.getByLabelText('Select Ekadash Vibhag - Moksh'));
    expect(selectedChip).toBeEnabled();
    fireEvent.click(selectedChip);
    expect(pos()).toBe('1 of 2');
    key('ArrowRight');
    expect(label()).toBe('Adhikaar · Ekadash Vibhag - Moksh');       // skipped the two in between
    expect(pos()).toBe('2 of 2');
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
});

test('"Random 10" picks 10 distinct sub-sections in page order and steps through just those', () => {
    setup({ subSections: many(25) });
    fireEvent.click(screen.getByRole('button', { name: /Random 10/ }));
    expect(screen.getAllByTitle('In this set')).toHaveLength(10);
    expect(pos()).toMatch(/^1 of 10$/);
    const seen = [];
    for (let i = 0; i < 9; i += 1) { seen.push(label()); key('ArrowRight'); }
    seen.push(label());
    expect(new Set(seen).size).toBe(10);
    const numbers = seen.map((l) => Number(l.match(/Section (\d+)/)[1]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
});

test('with fewer than 10 sub-sections, Random uses all of them', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Random 4/ }));
    expect(screen.getAllByTitle('In this set')).toHaveLength(4);
});

test('the filter narrows the list, and "Select shown" ticks only what is shown', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText(/Filter/), { target: { value: 'vibhag' } });
    const rail = screen.getByTestId('rail');
    expect(within(rail).getAllByRole('checkbox')).toHaveLength(3);
    expect(within(rail).queryByText('Prastavana')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Select shown'));
    expect(screen.getByRole('button', { name: /Selected \(3\)/ })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Filter/), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing matches.')).toBeInTheDocument();
});

test('the scan_config crop shows as bands that can be hidden, and is not drawn for multi-page books', async () => {
    setup();
    await screen.findByAltText('Start page 12');
    expect(screen.getAllByTestId('crop-band')).toHaveLength(4);        // top + bottom, on both panes
    fireEvent.click(screen.getByLabelText(/Show crop/));
    expect(screen.queryAllByTestId('crop-band')).toHaveLength(0);
});

test('multi-page: no crop bands, and the half of a boundary page outside the section is dimmed', async () => {
    setup({ multiPage: true, subSections: [{ name: 'Spread', start_page: 5, end_page: 9, start_side: 'right', end_side: 'left' }] });
    await screen.findByAltText('End page 9');
    expect(screen.queryAllByTestId('crop-band')).toHaveLength(0);
    expect(screen.queryByLabelText(/Show crop/)).not.toBeInTheDocument();
    const dims = screen.getAllByTestId('dim-side');
    expect(dims).toHaveLength(2);
    expect(within(screen.getByTestId('pane-start')).getByTestId('dim-side').className).toMatch(/left-0/);   // right half is the section
    expect(within(screen.getByTestId('pane-end')).getByTestId('dim-side').className).toMatch(/right-0/);    // left half is the section
});

test('pages outside the PDF, or missing from the config, say so instead of failing', async () => {
    setup({ subSections: [{ name: 'Broken', start_page: 5, end_page: 999 }, { name: 'No end', start_page: 7 }] });
    expect(await screen.findByText(/Page 999 is outside this PDF \(300 pages\)/)).toBeInTheDocument();
    expect(await screen.findByAltText('Start page 5')).toBeInTheDocument();
    key('ArrowRight');
    expect(await screen.findByText(/no end page/i)).toBeInTheDocument();
});

test('a page that cannot be rendered shows an error and the rest still works', async () => {
    const renderPageImage = jest.fn(async (_d, p) => { if (p === 39) throw new Error('boom'); return `data:x/${p}`; });
    setup({ renderPageImage });
    expect(await screen.findByText('Could not render page 39.')).toBeInTheDocument();
    expect(await screen.findByAltText('Start page 12')).toBeInTheDocument();
});

test('pages are rendered once and the next section is prepared ahead of time', async () => {
    const { renderPageImage } = setup();
    await screen.findByAltText('End page 39');
    await waitFor(() => expect(renderPageImage.mock.calls.map(([, p]) => p)).toEqual(expect.arrayContaining([56, 102])));  // next one, prefetched
    key('ArrowRight');
    await screen.findByAltText('End page 102');
    key('ArrowLeft');
    await screen.findByAltText('End page 39');
    const perPage = renderPageImage.mock.calls.reduce((m, [, p]) => ({ ...m, [p]: (m[p] || 0) + 1 }), {});
    expect(perPage[12]).toBe(1);
    expect(perPage[56]).toBe(1);   // visited, prefetched, revisited: still rendered once
});

test('opening a different PDF never serves pages cached from the previous one', async () => {
    const renderPageImage = jest.fn(async (doc, page) => `data:image/png;base64,${doc.id}-${page}`);
    const props = { subSections: SUBS, crop: null, multiPage: false, fileName: 'a.pdf', onClose: jest.fn(), renderPageImage };
    const { rerender } = render(<SubSectionVerifier pdfDoc={{ id: 'A', numPages: 300 }} {...props} />);
    await waitFor(() => expect(screen.getByAltText('Start page 12').src).toContain('A-12'));
    rerender(<SubSectionVerifier pdfDoc={{ id: 'B', numPages: 300 }} {...props} />);
    await waitFor(() => expect(screen.getByAltText('Start page 12').src).toContain('B-12'));
});

describe('helpers', () => {
    test('pickRandom returns k distinct sorted indexes, or all of them when n < k', () => {
        for (let i = 0; i < 50; i += 1) {
            const r = pickRandom(30, 10);
            expect(r).toHaveLength(10);
            expect(new Set(r).size).toBe(10);
            expect(r).toEqual([...r].sort((a, b) => a - b));
            expect(r.every((x) => x >= 0 && x < 30)).toBe(true);
        }
        expect(pickRandom(4, 10)).toEqual([0, 1, 2, 3]);
        expect(pickRandom(0, 10)).toEqual([]);
    });

    test('neighbours finds the previous and next member, even when current is not in the set', () => {
        expect(neighbours([1, 4, 9], 4)).toEqual({ prev: 1, next: 9 });
        expect(neighbours([1, 4, 9], 5)).toEqual({ prev: 4, next: 9 });
        expect(neighbours([1, 4, 9], 0)).toEqual({ prev: undefined, next: 1 });
        expect(neighbours([1, 4, 9], 9)).toEqual({ prev: 4, next: undefined });
        expect(neighbours([], 3)).toEqual({ prev: undefined, next: undefined });
    });
});
