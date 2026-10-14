import { useEffect, useRef, useState } from 'react';
import { api } from '../JobUI';
import { appendLogs, emptyBuffer } from './logBuffer';

export default function useLiveLogs(path, revision = 0) {
    const [buffer, setBuffer] = useState(emptyBuffer);
    const [checkedAt, setCheckedAt] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const cursor = useRef(null);
    useEffect(() => {
        cursor.current = null;
        setBuffer(emptyBuffer()); setCheckedAt(null); setError('');
    }, [path]);
    useEffect(() => {
        let alive = true;
        let timer;
        let controller;
        const tick = async () => {
            controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 35000);
            setLoading(true);
            try {
                const url = cursor.current ? `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor.current)}` : path;
                const result = await api(url, { signal: controller.signal, cache: 'no-store' });
                if (result.reachable === false) throw new Error(result.error || 'Logs unavailable');
                if (typeof result.text !== 'string') throw new Error('Invalid log response');
                if (alive) {
                    // A missing source (or older API) returns a snapshot without a cursor.
                    setBuffer(old => appendLogs(result.cursor ? old : emptyBuffer(), result));
                    cursor.current = result.cursor || null;
                    setCheckedAt(result.checked_at); setError('');
                }
            } catch (err) { if (alive) setError(err.name === 'AbortError' ? 'Log request timed out' : err.message); }
            finally {
                clearTimeout(timeout);
                if (alive) { setLoading(false); timer = setTimeout(tick, 3000); }
            }
        };
        tick();
        return () => { alive = false; clearTimeout(timer); controller?.abort(); };
    }, [path, revision]);
    return { buffer, checkedAt, error, loading };
}
