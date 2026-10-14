import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LiveLogViewer from './LiveLogViewer';
import { appendLogs, emptyBuffer } from './logBuffer';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../JobUI', () => ({ api: mocks.api }));
beforeEach(() => { vi.useFakeTimers(); mocks.api.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('appends cursor updates automatically without replacing previous entries', async () => {
    mocks.api.mockResolvedValueOnce({ text: 'first\n', cursor: 'one' }).mockResolvedValue({ text: 'second\n', cursor: 'two' });
    render(<LiveLogViewer path="/logs" />);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('region')).toHaveTextContent('first');
    expect(screen.getByRole('region')).toHaveTextContent('second');
    expect(mocks.api.mock.calls[1][0]).toBe('/logs?cursor=one');
});

it('pauses automatic scrolling when scrolled up and offers Latest, while logs keep arriving', async () => {
    mocks.api.mockResolvedValueOnce({ text: 'first\n', cursor: 'one' }).mockResolvedValue({ text: 'second\n', cursor: 'two' });
    render(<LiveLogViewer path="/logs" />);
    await act(async () => {});
    const region = screen.getByRole('region');
    Object.defineProperties(region, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 100 } });
    region.scrollTop = 100;
    fireEvent.scroll(region);
    expect(screen.getByRole('button', { name: '↓ Latest' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(region).toHaveTextContent('second');
    expect(region.scrollTop).toBe(100);
    fireEvent.click(screen.getByRole('button', { name: '↓ Latest' }));
    expect(region.scrollTop).toBe(1000);
    expect(screen.queryByRole('button', { name: '↓ Latest' })).toBeNull();
});

it('copies retained log text', async () => {
    mocks.api.mockResolvedValue({ text: 'copy me\n', cursor: 'one' });
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<LiveLogViewer path="/logs" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Copy logs' }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith('copy me\n');
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
});

it('limits line count and byte size while retaining the newest entries', () => {
    let buffer = appendLogs(emptyBuffer(), { text: 'one\ntwo\nthree\n' }, 2, 100);
    expect(buffer.text).toBe('two\nthree\n');
    expect(buffer.firstLine).toBe(1);
    buffer = appendLogs(buffer, { text: 'four\n' }, 2, 100);
    expect(buffer.text).toBe('three\nfour\n');
    expect(buffer.firstLine).toBe(2);
    expect(buffer.truncated).toBe(true);
    const large = appendLogs(emptyBuffer(), { text: '€'.repeat(100) }, 10000, 32);
    expect(new TextEncoder().encode(large.text).length).toBeLessThanOrEqual(32);
    expect(large.truncated).toBe(true);
});
