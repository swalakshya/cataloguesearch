import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { SearchFilters } from './SearchInterface';
const state = vi.hoisted(() => ({ rows: [], loading: false }));
vi.mock('../hooks/useCatalogue', () => ({ default: () => state }));
const rows = [
    { category: 'Books', language: 'hi', author: 'A', granth: 'Alpha' },
    { category: 'Books', language: 'hi', author: ['A', 'B'], granth: 'Shared' },
    { category: 'Books', language: 'hi', author: 'B', granth: 'Beta' },
    { category: 'Books', language: 'gu', author: 'A', granth: 'Gujarati' },
    { category: 'Granth', language: 'hi', author: 'Acharya', granth: 'Granth work' },
    { category: 'Granth', language: 'hi', author: 'Other', granth: 'Other granth' },
];
function Harness({ initial = [], language = 'hindi' }) {
    const [filters, setFilters] = useState(initial);
    return <><SearchFilters authorGroups={{ Books: { hindi: ['A', 'B'] }, Granth: { hindi: ['Acharya', 'Other'] } }}
        allMetadata={{ Granth: { hindi: { Name: ['Granth work', 'Other granth'] } }, Books: { hindi: { Name: ['Alpha', 'Beta', 'Shared', 'Unknown'] }, gujarati: { Name: ['Gujarati'] } } }}
        activeCategories={['Books', 'Granth']} language={language} activeFilters={filters}
        onUpdateFilters={setFilters} onAddFilter={f => setFilters(prev => [...prev, f])}
        onRemoveFilter={i => setFilters(prev => prev.filter((_, j) => i !== j))} />
        <output data-testid="filters">{JSON.stringify(filters)}</output></>;
}
const openBooks = () => fireEvent.click(screen.getByRole('button', { name: /^Books/ }));
const chooseAuthors = (...names) => {
    fireEvent.click(screen.getByRole('button', { name: /^Author/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Contemporary/ }));
    names.forEach(name => fireEvent.click(screen.getByRole('checkbox', { name })));
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
};
beforeEach(() => { state.rows = rows; state.loading = false; });
test('offers the union of selected authors and restores all books on clearing', () => {
    render(<Harness />); chooseAuthors('A'); openBooks();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: 'Beta' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search books...'), { target: { value: 'alp' } });
    expect(screen.queryByRole('checkbox', { name: 'Shared' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    chooseAuthors('B'); openBooks();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /^Author/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ })); openBooks();
    expect(screen.getByRole('checkbox', { name: 'Unknown' })).toBeInTheDocument();
});
test('prunes incompatible titles on author chip removal and preserves Granth filters', () => {
    render(<Harness initial={[{ key: 'Name', value: 'Beta' }, { key: 'Name', value: 'Granth work' }, { key: '_granth_authors', value: 'Acharya' }]} />);
    chooseAuthors('A', 'B');
    fireEvent.click(within(screen.getByText('Scholar: B')).getByRole('button'));
    const filters = JSON.parse(screen.getByTestId('filters').textContent);
    expect(filters).toContainEqual({ key: 'Name', value: 'Granth work' });
    expect(filters).toContainEqual({ key: '_granth_authors', value: 'Acharya' });
    expect(filters).not.toContainEqual({ key: 'Name', value: 'Beta' });
    expect(screen.getByText('Work selections outside the selected authors were removed.')).toBeInTheDocument();
});
test('respects language and saves visible selections', () => {
    render(<Harness language="gujarati" initial={[{ key: '_books_authors', value: 'A' }]} />); openBooks();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Gujarati' }));
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
    expect(JSON.parse(screen.getByTestId('filters').textContent)).toContainEqual({ key: 'Name', value: 'Gujarati' });
});
test.each([true, false])('preserves titles when catalogue unavailable (loading=%s)', loading => {
    state.rows = []; state.loading = loading;
    render(<Harness initial={[{ key: 'Name', value: 'Beta' }, { key: '_books_authors', value: 'A' }]} />); openBooks();
    expect(screen.getByRole('button', { name: /^Apply/ })).toBeDisabled();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /^Author/ }));
    expect(screen.getByRole('button', { name: /^Apply/ })).toBeDisabled();
    expect(screen.getByTestId('filters')).toHaveTextContent('Beta');
});

test('applying a different author removes incompatible titles in the same update', () => {
    render(<Harness initial={[{ key: 'Name', value: 'Beta' }]} />);
    chooseAuthors('A');
    expect(JSON.parse(screen.getByTestId('filters').textContent)).toEqual([{ key: '_books_authors', value: 'A' }]);
    openBooks();
    expect(screen.queryByRole('checkbox', { name: 'Beta' })).not.toBeInTheDocument();
});

test('each picker respects its own selected author category', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /^Author/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Acharya' }));
    fireEvent.click(screen.getByRole('tab', { name: /Contemporary/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Granth/ }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'Granth work' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Other granth' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    openBooks();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: 'Beta' })).not.toBeInTheDocument();
});

test('combines multiple Granth authors and prunes titles when a Granth author is removed', () => {
    render(<Harness initial={[{ key: 'Name', value: 'Other granth' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Author/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Acharya' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Granth/ }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(within(screen.getByText('Acharya/Gyani: Other')).getByRole('button'));
    expect(JSON.parse(screen.getByTestId('filters').textContent)).not.toContainEqual({ key: 'Name', value: 'Other granth' });
    fireEvent.click(screen.getByRole('button', { name: /^Granth/ }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
});
