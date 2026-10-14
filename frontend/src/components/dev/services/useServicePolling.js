import { useCallback, useEffect, useState } from 'react';
import { api } from '../JobUI';

// One cancellable request at a time. Failed refreshes preserve the last good data.
export default function useServicePolling(path, { interval = 0, revision = 0, timeoutMs = 20000, enabled = true, refreshPath = null } = {}) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    const refresh = useCallback(() => setRefreshKey(n => n + 1), []);
    useEffect(() => { setData(null); setError(''); }, [path]);
    useEffect(() => {
        if (!enabled) return;
        let alive = true;
        let timer;
        let controller;
        const tick = async () => {
            setLoading(true);
            controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const value = await api((refreshKey || revision) && refreshPath ? refreshPath : path, { signal: controller.signal, cache: 'no-store' });
                if (alive) { setData(value); setError(''); }
            } catch (err) { if (alive) setError(err.message); }
            finally {
                clearTimeout(timeout);
                if (alive) setLoading(false);
                if (alive && interval) timer = setTimeout(tick, interval);
            }
        };
        tick();
        return () => { alive = false; clearTimeout(timer); controller?.abort(); };
    }, [path, interval, revision, refreshKey, timeoutMs, enabled, refreshPath]);
    return { data, error, loading, refresh };
}
