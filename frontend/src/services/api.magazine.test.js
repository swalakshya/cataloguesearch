import { it, expect, vi, afterEach } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

it('retains and streams Magazine API results', async () => {
    const encoded = new TextEncoder().encode('data: ' + JSON.stringify({ type: 'category', category: 'Magazine',
        results: [{ document_id: 'issue-42', content_snippet: 'Evidence' }], total_hits: 25, page_number: 2 }) + '\n\n' +
        'data: {"type":"done","suggestions":[]}\n\n');
    let sent = false;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: { getReader: () => ({
        read: async () => sent ? { done: true } : (sent = true, { done: false, value: encoded }),
    }) } })));
    const progress = vi.fn();
    const result = await api.search({ query: 'आत्मा' }, progress);
    expect(result.magazine_results.total_hits).toBe(25);
    expect(result.magazine_results.page_number).toBe(2);
    expect(progress).toHaveBeenCalledWith('Magazine', expect.objectContaining({ magazine_results: expect.any(Object) }));
});
