import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StatsStrip from './StatsStrip';

const catalogue = vi.hoisted(() => ({ rows: [], loading: false }));
vi.mock('../../hooks/useCatalogue', () => ({ default: () => catalogue }));
afterEach(cleanup);

function renderStats(rows, loading = false) {
    catalogue.rows = rows;
    catalogue.loading = loading;
    render(<MemoryRouter><StatsStrip /></MemoryRouter>);
    return within(screen.getByRole('link', { name: /Granths/ }));
}
const work = { category: 'Granth', granth: 'Shrimad Rajchandra', author: 'Shrimad Rajchandra', anuyog: 'Dravyanuyog' };

describe('Granth stats count', () => {
    it('counts Hindi and Gujarati editions as one Granth', () => {
        const pill = renderStats([{ ...work, language: 'hi' }, { ...work, language: 'gu', tikakaar: null }]);
        expect(pill.getByText('1')).toBeTruthy();
    });

    it('keeps different authors, commentators and anuyogs separate', () => {
        const pill = renderStats([
            { ...work, language: 'hi' },
            { ...work, language: 'gu' },
            { ...work, author: 'Another author' },
            { ...work, tikakaar: 'Commentator A' },
            { ...work, tikakaar: 'Commentator B' },
            { ...work, anuyog: 'Charananuyog' },
            { category: 'Books', granth: 'Book' },
            { category: 'Pravachan', granth: 'Series', count: '25' },
        ]);
        expect(pill.getByText('5')).toBeTruthy();
        expect(within(screen.getByRole('link', { name: /Pravachans/ })).getByText('25')).toBeTruthy();
        expect(within(screen.getByRole('link', { name: /Contemporary Jain Books/ })).getByText('1')).toBeTruthy();
    });

    it('does not show a count while the catalogue is loading', () => {
        const pill = renderStats([{ ...work, language: 'hi' }], true);
        expect(pill.queryByText('1')).toBeNull();
    });
});
