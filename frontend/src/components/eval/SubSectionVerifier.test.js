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

describe('reviewing neighbouring pages, and SET', () => {
    const click = (name) => fireEvent.click(screen.getByRole('button', { name }));
    const setBtn = (re) => screen.queryByRole('button', { name: re });

    test('each pane steps to the neighbouring page and can reset to the config page', async () => {
        setup();
        await screen.findByAltText('Start page 12');
        click('Start next page');
        expect(await screen.findByAltText('Start page 13')).toBeInTheDocument();
        expect(screen.getByTestId('moved-start')).toHaveTextContent('config says p.12');
        expect(screen.queryByTestId('moved-end')).toBeNull();                       // the End pane did not move
        click('End previous page'); click('End previous page');
        expect(await screen.findByAltText('End page 37')).toBeInTheDocument();
        click('Start previous page'); click('Start previous page');
        expect(await screen.findByAltText('Start page 11')).toBeInTheDocument();
        fireEvent.click(within(screen.getByText(/Start/, { selector: 'span' }).closest('div').parentElement).getByRole('button', { name: 'Reset' }));
        expect(await screen.findByAltText('Start page 12')).toBeInTheDocument();
        expect(screen.queryByTestId('moved-start')).toBeNull();
    });

    test('the keys [ ] , . step the Start and End pages', async () => {
        setup();
        await screen.findByAltText('End page 39');
        key(']'); key(']');
        expect(await screen.findByAltText('Start page 14')).toBeInTheDocument();
        key('['); key('[');  key('[');
        expect(await screen.findByAltText('Start page 11')).toBeInTheDocument();
        key('.');
        expect(await screen.findByAltText('End page 40')).toBeInTheDocument();
        key(',');  key(',');
        expect(await screen.findByAltText('End page 38')).toBeInTheDocument();
    });

    test('stepping stays inside the PDF', async () => {
        setup({ subSections: [{ name: 'A', start_page: 1, end_page: 300 }] });
        await screen.findByAltText('Start page 1');
        expect(screen.getByRole('button', { name: 'Start previous page' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'End next page' })).toBeDisabled();
    });

    test('moving to another sub-section drops the stepped page, and stepping never touches the config values shown in the list', async () => {
        setup();
        await screen.findByAltText('Start page 12');
        click('Start next page');
        key('ArrowRight');
        expect(await screen.findByAltText('Start page 56')).toBeInTheDocument();
        key('ArrowLeft');
        expect(await screen.findByAltText('Start page 12')).toBeInTheDocument();
        expect(screen.getByTestId('rail')).toHaveTextContent('12–39');
    });

    test('there is no SET unless the sub-sections come from the configs repo, and the reason is shown', async () => {
        setup({ editable: false, editNote: 'Read-only: this scan_config.json is not in the configs repo.', onSetPage: jest.fn() });
        await screen.findByAltText('Start page 12');
        click('Start next page');
        expect(setBtn(/SET/)).toBeNull();
        expect(screen.getByText(/not in the configs repo/)).toBeInTheDocument();
    });

    test('SET appears only once the pane is off the config page, and sends what is on screen', async () => {
        const onSetPage = jest.fn().mockResolvedValue();
        setup({ editable: true, onSetPage });
        await screen.findByAltText('Start page 12');
        expect(setBtn(/SET/)).toBeNull();
        click('Start next page');
        fireEvent.click(await screen.findByRole('button', { name: 'SET start = 13' }));
        await waitFor(() => expect(onSetPage).toHaveBeenCalledWith(0, 'start', 13, SUBS[0]));
    });

    test('after a successful SET the marker clears, and Undo puts the old page back', async () => {
        let subs = SUBS;
        const onSetPage = jest.fn().mockImplementation(async (index, which, page) => {
            subs = subs.map((s, i) => (i === index ? { ...s, [`${which}_page`]: page } : s));
            view.rerender(el(subs));
        });
        const el = (list) => <SubSectionVerifier pdfDoc={{ numPages: 300 }} subSections={list} crop={null} multiPage={false} fileName="x.pdf"
            onClose={() => {}} renderPageImage={async (_d, p) => `data:image/png;base64,P${p}`} editable onSetPage={onSetPage} />;
        const view = render(el(subs));
        await screen.findByAltText('End page 39');
        click('End next page');
        fireEvent.click(await screen.findByRole('button', { name: 'SET end = 40' }));
        expect(await screen.findByTestId('saved-note')).toHaveTextContent('end_page 39 → 40');
        expect(screen.queryByTestId('moved-end')).toBeNull();
        expect(screen.getByTestId('rail')).toHaveTextContent('12–40');
        fireEvent.click(within(screen.getByTestId('saved-note')).getByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(onSetPage).toHaveBeenLastCalledWith(0, 'end', 39, expect.objectContaining({ end_page: 40 })));
        await waitFor(() => expect(screen.queryByTestId('saved-note')).toBeNull());
    });

    test('a refused save shows the reason and keeps the page you were looking at', async () => {
        const onSetPage = jest.fn().mockRejectedValue(new Error('The file changed since it was loaded. Reopen the file.'));
        setup({ editable: true, onSetPage });
        await screen.findByAltText('Start page 12');
        click('Start next page');
        fireEvent.click(await screen.findByRole('button', { name: 'SET start = 13' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('The file changed since it was loaded');
        expect(screen.getByAltText('Start page 13')).toBeInTheDocument();
        expect(screen.queryByTestId('saved-note')).toBeNull();
    });

    test('SET is blocked when start would pass end, or end would go before start', async () => {
        setup({ editable: true, onSetPage: jest.fn(), subSections: [{ name: 'A', start_page: 10, end_page: 11 }] });
        await screen.findByAltText('Start page 10');
        click('Start next page'); click('Start next page');                       // start 12 > end 11
        expect(screen.getByRole('button', { name: 'SET start = 12' })).toBeDisabled();
        click('Start previous page');                                            // start 11 = end 11 is fine
        expect(screen.getByRole('button', { name: 'SET start = 11' })).toBeEnabled();
        click('End previous page'); click('End previous page');                  // end 9 < start 10
        expect(screen.getByRole('button', { name: 'SET end = 9' })).toBeDisabled();
    });
});

describe('removing and merging sub-sections', () => {
    const tick = (name) => fireEvent.click(screen.getByLabelText(`Select ${name}`));
    const btn = (re) => screen.getByRole('button', { name: re });
    const ref = (i) => ({ index: i, name: SUBS[i].name, field: SUBS[i].field, start_page: SUBS[i].start_page, end_page: SUBS[i].end_page });
    // The parent owns the list; this stands in for it, applying what the server would return.
    const harness = (apply) => {
        const onEditSections = jest.fn(async (action, payload) => { const list = apply(action, payload); view.rerender(el(list)); return list; });
        const el = (list) => <SubSectionVerifier pdfDoc={{ numPages: 300 }} subSections={list} crop={null} multiPage={false} fileName="x.pdf"
            onClose={onClose} renderPageImage={async (_d, p) => `data:image/png;base64,P${p}`} editable onSetPage={jest.fn()} onEditSections={onEditSections} />;
        const onClose = jest.fn();
        const view = render(el(SUBS));
        return { onEditSections, onClose };
    };

    test('with nothing ticked, Remove offers the sub-section on screen and, once confirmed, removes it', async () => {
        const { onEditSections } = harness(() => SUBS.slice(1));
        await screen.findByAltText('Start page 12');
        fireEvent.click(btn(/^Remove \(1\)/));
        const dialog = screen.getByRole('dialog', { name: 'Remove sub-sections' });
        expect(dialog).toHaveTextContent('Remove 1 sub-section?');
        expect(dialog).toHaveTextContent('Prastavana');
        expect(dialog).toHaveTextContent('p.12–39');
        expect(onEditSections).not.toHaveBeenCalled();                              // nothing happens before confirming
        fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
        await waitFor(() => expect(onEditSections).toHaveBeenCalledWith('remove', { items: [ref(0)] }));
        expect(await screen.findByTestId('edit-note')).toHaveTextContent('Removed 1 sub-section (Prastavana)');
        expect(screen.queryByRole('dialog', { name: 'Remove sub-sections' })).toBeNull();
        expect(label()).toBe('Adhikaar · Pratham Vibhag - Jambudvip');              // the next one is on screen now
        expect(screen.getByTestId('rail')).not.toHaveTextContent('Prastavana');
    });

    test('with several ticked, Remove takes exactly those', async () => {
        const { onEditSections } = harness(() => [SUBS[1], SUBS[3]]);
        await screen.findByAltText('Start page 12');
        tick('Prastavana'); tick('Dwitiya Vibhag - Lavan Samudra');
        fireEvent.click(btn(/^Remove \(2\)/));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove sub-sections' })).getByRole('button', { name: 'Remove' }));
        await waitFor(() => expect(onEditSections).toHaveBeenCalledWith('remove', { items: [ref(0), ref(2)] }));
        await waitFor(() => expect(btn(/^Merge \(0\)/)).toBeDisabled());             // the ticks are cleared: the indexes changed
    });

    test('Cancel and Esc close the dialog without touching the file, and Esc does not close the verifier', async () => {
        const { onEditSections, onClose } = harness(() => SUBS);
        await screen.findByAltText('Start page 12');
        fireEvent.click(btn(/^Remove/));
        key('Escape');
        expect(screen.queryByRole('dialog', { name: 'Remove sub-sections' })).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(btn(/^Remove/));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove sub-sections' })).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog', { name: 'Remove sub-sections' })).toBeNull();
        expect(onEditSections).not.toHaveBeenCalled();
        key('Escape');
        expect(onClose).toHaveBeenCalled();
    });

    test('while the dialog is open the arrow and page keys do nothing', async () => {
        harness(() => SUBS);
        await screen.findByAltText('Start page 12');
        fireEvent.click(btn(/^Remove/));
        key('ArrowRight'); key(']');
        expect(label()).toBe('Adhikaar · Prastavana');
        expect(screen.queryByTestId('moved-start')).toBeNull();
    });

    test('Merge needs two or more neighbouring ticked sub-sections', async () => {
        harness(() => SUBS);
        await screen.findByAltText('Start page 12');
        expect(btn(/^Merge/)).toBeDisabled();
        tick('Prastavana');
        expect(btn(/^Merge \(1\)/)).toBeDisabled();
        tick('Dwitiya Vibhag - Lavan Samudra');                                      // skips Pratham Vibhag
        expect(btn(/^Merge \(2\)/)).toBeDisabled();
        tick('Pratham Vibhag - Jambudvip');
        expect(btn(/^Merge \(3\)/)).toBeEnabled();
    });

    test('Merge asks for the name, shows the joined page range, and sends the ticked ones with that name', async () => {
        const merged = { field: 'Adhikaar', name: 'Vibhag 1 and 2', start_page: 56, end_page: 114 };
        const { onEditSections } = harness(() => [SUBS[0], merged, SUBS[3]]);
        await screen.findByAltText('Start page 12');
        tick('Pratham Vibhag - Jambudvip'); tick('Dwitiya Vibhag - Lavan Samudra');
        fireEvent.click(btn(/^Merge \(2\)/));
        const dialog = screen.getByRole('dialog', { name: 'Merge sub-sections' });
        expect(dialog).toHaveTextContent('p.56');
        expect(dialog).toHaveTextContent('p.114');                                   // first start .. last end
        const confirm = within(dialog).getByRole('button', { name: 'Merge' });
        expect(confirm).toBeDisabled();                                              // no name yet
        fireEvent.change(within(dialog).getByLabelText(/Name of the merged/), { target: { value: '  Vibhag 1 and 2 ' } });
        expect(confirm).toBeEnabled();
        fireEvent.click(confirm);
        await waitFor(() => expect(onEditSections).toHaveBeenCalledWith('merge', { items: [ref(1), ref(2)], name: 'Vibhag 1 and 2' }));
        expect(await screen.findByTestId('edit-note')).toHaveTextContent('Merged 2 sub-sections into "Vibhag 1 and 2"');
        expect(label()).toBe('Adhikaar · Vibhag 1 and 2');
        expect(screen.getByText(/pages 56–114/)).toBeInTheDocument();
    });

    test('a refused edit keeps the dialog open with the reason', async () => {
        const onEditSections = jest.fn().mockRejectedValue(new Error('The file changed since it was loaded. Reopen the file.'));
        setup({ editable: true, onSetPage: jest.fn(), onEditSections });
        await screen.findByAltText('Start page 12');
        fireEvent.click(btn(/^Remove/));
        const dialog = screen.getByRole('dialog', { name: 'Remove sub-sections' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('The file changed since it was loaded');
        expect(screen.queryByTestId('edit-note')).toBeNull();
    });

    test('Undo asks the server to put the file back', async () => {
        const { onEditSections } = harness((action) => (action === 'undo' ? SUBS : SUBS.slice(1)));
        await screen.findByAltText('Start page 12');
        fireEvent.click(btn(/^Remove/));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove sub-sections' })).getByRole('button', { name: 'Remove' }));
        fireEvent.click(await within(await screen.findByTestId('edit-note')).findByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(onEditSections).toHaveBeenLastCalledWith('undo', {}));
        await waitFor(() => expect(screen.queryByTestId('edit-note')).toBeNull());
        expect(screen.getByTestId('rail')).toHaveTextContent('Prastavana');
    });

    test('no Remove or Merge when the config is not from the configs repo', async () => {
        setup({ editable: false, editNote: 'Read-only: …', onSetPage: jest.fn(), onEditSections: jest.fn() });
        await screen.findByAltText('Start page 12');
        expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
    });
});

describe('whole-book mode (no real sub_sections)', () => {
    const WHOLE = [{ name: 'Whole book', start_page: 1, end_page: 300 }];
    const setupWhole = (props = {}) => setup({ subSections: WHOLE, wholeBookMode: true, ...props });

    test('shows the whole book as the one section, with no rail or mode chips', async () => {
        setupWhole();
        expect(await screen.findByAltText('Start page 1')).toBeInTheDocument();
        expect(label()).toBe('Whole book');
        expect(screen.getByText(/pages 1–300/)).toBeInTheDocument();
        expect(screen.queryByTestId('rail')).not.toBeInTheDocument();
        expect(screen.queryByTestId('position')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^All \(/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Random/ })).not.toBeInTheDocument();
    });

    test('page stepping, Reset and SET work exactly as for a real sub-section', async () => {
        const onSetPage = jest.fn().mockResolvedValue();
        setupWhole({ editable: true, onSetPage });
        await screen.findByAltText('Start page 1');
        fireEvent.click(screen.getByRole('button', { name: 'Start next page' }));
        expect(await screen.findByAltText('Start page 2')).toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: 'SET start = 2' }));
        await waitFor(() => expect(onSetPage).toHaveBeenCalledWith(0, 'start', 2, WHOLE[0]));
    });

    test('there is no Remove or Merge, even if onEditSections were supplied', async () => {
        setupWhole({ editable: true, onSetPage: jest.fn(), onEditSections: jest.fn() });
        await screen.findByAltText('Start page 1');
        expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Merge/ })).not.toBeInTheDocument();
    });

    test('Esc still closes, and ← → do nothing (nothing to navigate to)', async () => {
        const { onClose } = setupWhole();
        await screen.findByAltText('Start page 1');
        key('ArrowRight');
        expect(label()).toBe('Whole book');
        key('Escape');
        expect(onClose).toHaveBeenCalled();
    });
});

describe('crop editing', () => {
    const setupCrop = (props = {}) => setup({ crop: { top: 9, bottom: 4, left: 0, right: 0 }, cropEditable: true, onSetCrop: jest.fn().mockResolvedValue(), ...props });
    const cropInput = (side) => screen.getByLabelText(`Crop ${side} %`);

    test('shows the loaded values, and there is no SET until something changes', async () => {
        setupCrop();
        await screen.findByAltText('Start page 12');
        expect(cropInput('top')).toHaveValue(9);
        expect(cropInput('bottom')).toHaveValue(4);
        expect(screen.queryByRole('button', { name: 'SET crop' })).not.toBeInTheDocument();
    });

    test('editing a value shows SET and Reset, and the band updates live', async () => {
        setupCrop();
        await screen.findByAltText('Start page 12');
        fireEvent.change(cropInput('top'), { target: { value: '20' } });
        expect(screen.getByRole('button', { name: 'SET crop' })).toBeInTheDocument();
        const startBand = within(screen.getByTestId('pane-start')).getAllByTestId('crop-band')[0];
        const endBand = within(screen.getByTestId('pane-end')).getAllByTestId('crop-band')[0];
        expect(startBand.style.height).toBe('20%');
        expect(endBand.style.height).toBe('20%');   // both panes reflect the same file-level crop
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(cropInput('top')).toHaveValue(9);
        expect(screen.queryByRole('button', { name: 'SET crop' })).not.toBeInTheDocument();
    });

    test('SET crop sends the edited values; once the parent refreshes crop to match, it shows Saved', async () => {
        // Mirrors what PDFParser really does: onSetCrop resolves, then the parent re-renders with the new crop
        // prop (from its own refreshed scan_config) -- that is what actually clears "changed" and reveals Saved.
        let cropProp = { top: 9, bottom: 4, left: 0, right: 0 };
        const onSetCrop = jest.fn(async (next) => { cropProp = next; view.rerender(el()); });
        const el = () => <SubSectionVerifier pdfDoc={{ numPages: 300 }} subSections={SUBS} crop={cropProp} multiPage={false}
            fileName="LokVibhag.pdf" onClose={() => {}} renderPageImage={async (_d, p) => `data:image/png;base64,P${p}`}
            cropEditable onSetCrop={onSetCrop} />;
        const view = render(el());
        await screen.findByAltText('Start page 12');
        fireEvent.change(cropInput('top'), { target: { value: '6' } });
        fireEvent.change(cropInput('left'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: 'SET crop' }));
        await waitFor(() => expect(onSetCrop).toHaveBeenCalledWith({ top: 6, bottom: 4, left: 3, right: 0 }));
        expect(await screen.findByTestId('crop-saved-note')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'SET crop' })).not.toBeInTheDocument();
        expect(cropInput('top')).toHaveValue(6);   // the (now-loaded) value stays shown, not reset to the pre-edit one
    });

    test('a refused crop save shows the reason and keeps the edited values', async () => {
        const onSetCrop = jest.fn().mockRejectedValue(new Error('The file changed on disk since you opened it.'));
        setupCrop({ onSetCrop });
        await screen.findByAltText('Start page 12');
        fireEvent.change(cropInput('top'), { target: { value: '6' } });
        fireEvent.click(screen.getByRole('button', { name: 'SET crop' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('changed on disk');
        expect(cropInput('top')).toHaveValue(6);
    });

    test('is entirely absent (no inputs) when not editable, but says why', async () => {
        setupCrop({ cropEditable: false, cropEditNote: 'Read-only: this file is not in the configs repo.' });
        await screen.findByAltText('Start page 12');
        expect(screen.queryByTestId('crop-controls')).not.toBeInTheDocument();
        expect(screen.getByTestId('crop-read-only')).toHaveTextContent('not in the configs repo');
    });

    test('is absent for multi-page books regardless of editability', async () => {
        setupCrop({ multiPage: true });
        await screen.findByAltText('Start page 12');
        expect(screen.queryByTestId('crop-controls')).not.toBeInTheDocument();
    });

    test('re-seeds from a new loaded crop (e.g. after a save refreshed it) without keeping stale local edits', async () => {
        const view = render(<SubSectionVerifier pdfDoc={{ numPages: 300 }} subSections={SUBS} crop={{ top: 9, bottom: 4, left: 0, right: 0 }}
            multiPage={false} fileName="x.pdf" onClose={() => {}} renderPageImage={async (_d, p) => `data:image/png;base64,P${p}`}
            cropEditable onSetCrop={jest.fn()} />);
        await screen.findByAltText('Start page 12');
        fireEvent.change(cropInput('top'), { target: { value: '15' } });   // an in-progress local edit, not yet saved
        expect(cropInput('top')).toHaveValue(15);
        // the parent reloads and hands back a DIFFERENT crop than either the original or the in-progress edit --
        // e.g. someone else (or a different edit path) changed it in the meantime
        view.rerender(<SubSectionVerifier pdfDoc={{ numPages: 300 }} subSections={SUBS} crop={{ top: 6, bottom: 4, left: 0, right: 0 }}
            multiPage={false} fileName="x.pdf" onClose={() => {}} renderPageImage={async (_d, p) => `data:image/png;base64,P${p}`}
            cropEditable onSetCrop={jest.fn()} />);
        expect(cropInput('top')).toHaveValue(6);   // the stale local "15" did not survive the reload
        expect(screen.queryByRole('button', { name: 'SET crop' })).not.toBeInTheDocument();
    });

    test('the Show crop toggle appears whenever crop is editable, even if every value is currently zero', async () => {
        setupCrop({ crop: { top: 0, bottom: 0, left: 0, right: 0 } });
        await screen.findByAltText('Start page 12');
        expect(screen.getByText('Show crop')).toBeInTheDocument();
    });
});
