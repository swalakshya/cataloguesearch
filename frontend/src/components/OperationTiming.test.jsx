import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OperationTiming } from './OperationTiming';
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('hides old messages without timings and displays only the completed total', () => {
    const { rerender, container } = render(<OperationTiming />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OperationTiming kind="search" timings={{ total_ms: 18400, operations: { retrieval: 1200, context: 800, reranking: 15100 } }} />);
    expect(screen.getByText('Searched in 18.4s')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Reranking')).not.toBeInTheDocument();
});
it('shows elapsed time while running without inventing operation timings', () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    render(<OperationTiming running startedAt={7000} label="Searching" />);
    expect(screen.getByText('Searching… 3s')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
