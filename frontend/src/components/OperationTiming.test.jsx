import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OperationTiming } from './OperationTiming';
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('hides old messages with no timings and keeps completed details collapsed', () => {
    const { rerender, container } = render(<OperationTiming />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OperationTiming kind="search" timings={{ total_ms: 18400, operations: { retrieval: 1200, context: 800, reranking: 15100 } }} />);
    const button = screen.getByRole('button', { name: /Searched in 18.4s/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Reranking')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByText('Reranking')).toBeInTheDocument();
});
it('shows elapsed time while running without inventing operation timings', () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    render(<OperationTiming running startedAt={7000} label="Searching" />);
    expect(screen.getByText('Searching… 3s')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
