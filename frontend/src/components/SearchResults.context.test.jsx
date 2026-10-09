import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, it, expect } from 'vitest';
import { ResultCard } from './SearchResults';

afterEach(cleanup);
const result = { document_id: 'central', content_snippet: 'Central passage', page_number: 12,
    metadata: { Name: 'Book' }, file_url: 'https://example.com/book.pdf' };

it('shows expandable surrounding excerpts with the neighbours own PDF pages', () => {
    render(<ResultCard result={{ ...result, rerank_context: {
        previous: { document_id: 'before', content_snippet: 'Previous explanation', page_number: 11, pdf_page_number: 21, file_url: result.file_url },
        next: { document_id: 'after', content_snippet: 'Following explanation', page_number: 13, pdf_page_number: 23, file_url: result.file_url },
    } }} />);
    const summary = screen.getByText('Surrounding context');
    expect(summary.closest('details')).not.toBeNull();
    expect(screen.getByText('Central passage')).toBeTruthy();
    expect(screen.getByText('Previous explanation')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Before · Page 11' }).href).toContain('#page=21');
    expect(screen.getByRole('link', { name: 'After · Page 13' }).href).toContain('#page=23');
});

it('keeps the ordinary result unchanged when no context was returned', () => {
    render(<ResultCard result={result} />);
    expect(screen.queryByText('Surrounding context')).toBeNull();
    expect(screen.getByText('Central passage')).toBeTruthy();
});
