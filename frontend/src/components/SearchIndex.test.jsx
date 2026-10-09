import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, within, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SearchIndex from './SearchIndex';

vi.mock('../hooks/useCatalogue', () => ({
  default: () => ({ loading: false, rows: [
    { category: 'Granth', granth: 'Shrimad Rajchandra', author: 'Shrimad Rajchandra', anuyog: 'Dravyanuyog', language: 'hi', relative_path: 'hi/shrimad' },
    { category: 'Granth', granth: 'Shrimad Rajchandra', author: 'Shrimad Rajchandra', anuyog: 'Dravyanuyog', language: 'gu', relative_path: 'gu/shrimad' },
    { category: 'Granth', granth: 'Other commentary', author: 'Author', tikakaar: 'Commentator A', anuyog: 'Dravyanuyog', language: 'hi', relative_path: 'hi/a' },
    { category: 'Granth', granth: 'Other commentary', author: 'Author', tikakaar: 'Commentator B', anuyog: 'Dravyanuyog', language: 'gu', relative_path: 'gu/b' },
    { category: 'Pravachan', granth: 'Niyamsaar', series: '1975 Series', count: '10', language: 'hi', relative_path: 'prav/hi' },
    { category: 'Pravachan', granth: 'Niyamsaar', series: '1975 Series', count: '10', language: 'gu', relative_path: 'prav/gu' },
  ] }),
}));
vi.mock('./chat/StatsStrip', () => ({ default: () => null }));
afterEach(cleanup);

it('merges matching Granth editions, preserves different commentaries, and shows language pills', async () => {
  const { container } = render(<MemoryRouter><SearchIndex /></MemoryRouter>);
  const granth = within(container.querySelector('#granth-index'));
  await waitFor(() => expect(granth.getAllByText('Shrimad Rajchandra')).toHaveLength(2)); // title + author in one row
  const row = granth.getAllByText('Shrimad Rajchandra')[0].closest('tr');
  expect(within(row).getByLabelText('Hindi').textContent).toBe('हि');
  expect(within(row).getByLabelText('Gujarati').textContent).toBe('ગુ');
  expect(granth.getAllByText('Other commentary')).toHaveLength(2);
  expect(granth.getByRole('columnheader', { name: 'Language' })).toBeTruthy();
  fireEvent.click(granth.getByRole('button', { name: 'ગુજરાતી' }));
  expect(granth.queryByText('Commentator B')).toBeNull();
  expect(granth.getByText('Commentator A')).toBeTruthy();
  expect(granth.getAllByText('Shrimad Rajchandra')).toHaveLength(2);
});

it('uses one Language column for Pravachan with both availability pills', async () => {
  const { container } = render(<MemoryRouter><SearchIndex /></MemoryRouter>);
  const section = within(container.querySelector('#pravachan-index'));
  await waitFor(() => expect(section.getByText('1975 Series')).toBeTruthy());
  expect(section.getByRole('columnheader', { name: 'Language' })).toBeTruthy();
  expect(section.queryByRole('columnheader', { name: 'Hindi' })).toBeNull();
  expect(section.queryByRole('columnheader', { name: 'Gujarati' })).toBeNull();
  const row = section.getByText('1975 Series').closest('tr');
  expect(within(row).getByLabelText('Hindi').textContent).toBe('हि');
  expect(within(row).getByLabelText('Gujarati').textContent).toBe('ગુ');
});
