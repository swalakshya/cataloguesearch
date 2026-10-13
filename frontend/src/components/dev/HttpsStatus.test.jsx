import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import HttpsPill, { httpsSummary } from './HttpsStatus';

afterEach(cleanup);
const now = Date.parse('2026-10-13T00:00:00Z');
const report = days => ({ reachable: true,
    endpoints: [{ domain: 'swalakshya.me', valid: true, expires_at: new Date(now + days * 86400000).toISOString() }],
    renewal: { timer: { ActiveState: 'active' }, service: { Result: 'success' } } });

it.each([[30.001, 'green'], [30, 'orange'], [10, 'orange'], [9.999, 'red'], [-1, 'red']])('uses exact day boundaries: %s', (days, color) => {
    expect(httpsSummary(report(days), now).state).toBe(color);
});
it('keeps renewal warnings independent of expiry color', () => {
    const data = report(60);
    data.renewal.service.Result = 'exit-code';
    expect(httpsSummary(data, now)).toMatchObject({ state: 'green', warning: true });
    expect(httpsSummary({ reachable: false })).toEqual({ state: 'unknown' });
});
it('shows expiry on hover and click, confirms renewal, then opens Production and starts the job', () => {
    const renew = vi.fn();
    render(<MemoryRouter initialEntries={['/dev']}><HttpsPill https={{ report: report(60), renew }} />
        <Routes><Route path="/dev" element={null} /><Route path="/deploy" element={<p>Production page</p>} /></Routes>
    </MemoryRouter>);
    expect(screen.getByTestId('https-pill').title).toContain('HTTPS expires');
    fireEvent.click(screen.getByTestId('https-pill'));
    expect(screen.getByRole('dialog', { name: 'HTTPS credentials' })).toHaveTextContent('Expires:');
    fireEvent.click(screen.getByRole('button', { name: 'Renew credentials' }));
    expect(renew).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'prod' } });
    fireEvent.click(screen.getByRole('button', { name: 'Renew credentials' }));
    expect(renew).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Production page')).toBeInTheDocument();
});
