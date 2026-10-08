import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AuthorFilter from './AuthorFilter';
const groups = { Granth: { hindi: ['Shared', 'Acharya'], gujarati: ['Gujarati Acharya'] }, Books: { hindi: ['Shared', 'Scholar'], gujarati: [] } };
function Harness({ language = 'hindi', categories = ['Granth', 'Books'] }) {
    const [filters, setFilters] = useState([{ key: 'Name', value: 'Existing work' }]);
    return <><AuthorFilter authorGroups={groups} activeCategories={categories} language={language} activeFilters={filters}
        onAddFilter={filter => setFilters(previous => [...previous, filter])}
        onRemoveFilter={index => setFilters(previous => previous.filter((_, i) => i !== index))} />
        <output data-testid="filters">{JSON.stringify(filters)}</output></>;
}
const open = () => fireEvent.click(screen.getByRole('button', { name: /^Author/ }));
const apply = () => fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
const filters = () => JSON.parse(screen.getByTestId('filters').textContent);
test('scopes the same author to each category and clears without removing titles', () => {
    render(<Harness />); open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shared' }));
    fireEvent.click(screen.getByRole('tab', { name: /Contemporary/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shared' })); apply();
    expect(filters()).toEqual([{ key: 'Name', value: 'Existing work' }, { key: '_granth_authors', value: 'Shared' }, { key: '_books_authors', value: 'Shared' }]);
    open(); expect(screen.getByRole('checkbox', { name: 'Shared' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' })); apply();
    expect(filters()).toEqual([{ key: 'Name', value: 'Existing work' }]);
});
test('searches names and discards unapplied changes on dismissal', () => {
    render(<Harness />); open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search authors' }), { target: { value: 'ach' } });
    expect(screen.queryByRole('checkbox', { name: 'Shared' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Acharya' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(filters()).toHaveLength(1); open();
    expect(screen.getByRole('checkbox', { name: 'Acharya' })).not.toBeChecked();
});
test('uses the selected language and respects disabled categories', () => {
    render(<Harness language="gujarati" categories={['Granth']} />); open();
    expect(screen.getByRole('checkbox', { name: 'Gujarati Acharya' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Acharya' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Contemporary/ })).toBeDisabled();
});
