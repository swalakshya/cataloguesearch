import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ParagraphGenEval from './ParagraphGenEval';

// Before any file or folder is chosen, Gen Eval shows its "Select Directories" card. It shares the width hack with the
// main screen, so it is the part that can be rendered without a real file system.
beforeEach(() => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});

const renderEval = (props) => render(<ParagraphGenEval basePaths={{ base_pdf_path: '/pdf', base_ocr_path: '/ocr', base_text_path: '/text' }} {...props} />);

test('the default (non-fill) layout keeps the widened card', () => {
    const { container } = renderEval();
    expect(screen.getByText('Select Directories to Compare')).toBeInTheDocument();
    expect(container.querySelector('[style*="max-width: none"]').style.width).toBe('130%');
});

test('fill uses the normal width and fills the height', () => {
    const { container } = renderEval({ fill: true });
    const card = container.querySelector('[style*="max-width: none"]');
    expect(card.style.width).toBe('100%');
    expect(card.className).toMatch(/h-full flex flex-col/);
});

import { genEvalLayout } from './genEvalLayout';

describe('genEvalLayout', () => {
    test('normal layout is exactly what it was: widened card, 700px scroll boxes, image fit to width', () => {
        const L = genEvalLayout(false);
        expect(L.cardWidth).toBe('130%');
        expect(L.card).not.toMatch(/h-full/);
        expect(L.title).toMatch(/text-2xl/);
        expect(L.leftScroll).toMatch(/max-h-\[700px\] overflow-y-auto/);
        expect(L.rightScroll).toMatch(/max-h-\[700px\] overflow-y-auto/);
        expect(L.pdfImage).toBe('max-w-full h-auto');
        expect(L.leftCol).toBe('flex-1 p-4 border-r border-slate-200');
        expect(L.rightCol).toBe('flex-1 p-4');
        expect(L.row).toBe('flex flex-col lg:flex-row');
    });

    test('fill: normal-width card, panes fill the height, no 700px cap, the PDF page fits the pane', () => {
        const L = genEvalLayout(true);
        expect(L.cardWidth).toBe('100%');
        expect(L.card).toMatch(/h-full flex flex-col/);
        expect(L.title).toBe('hidden');
        expect(L.row).toMatch(/flex-1 min-h-0/);
        for (const box of [L.leftBox, L.rightBox]) expect(box).toMatch(/flex-1 min-h-0 flex flex-col/);
        for (const scroll of [L.leftScroll, L.rightScroll]) {
            expect(scroll).toMatch(/flex-1 min-h-0 overflow-y-auto/);
            expect(scroll).not.toMatch(/max-h-\[700px\]/);
        }
        expect(L.pdfImage).toMatch(/max-h-full/);
        expect(L.pdfImage).toMatch(/object-contain/);
        expect(L.leftCol).toMatch(/min-h-0/);
        expect(L.rightCol).toMatch(/min-h-0/);
    });
});
