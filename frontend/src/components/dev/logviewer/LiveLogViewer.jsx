import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import useLiveLogs from './useLiveLogs';

export default function LiveLogViewer({ path, revision = 0, label = 'Local service logs', empty = 'No logs yet. Start the service to generate logs.' }) {
    const { buffer, checkedAt, error, loading } = useLiveLogs(path, revision);
    const box = useRef(null);
    const anchor = useRef(null);
    const following = useRef(true);
    const [atLatest, setAtLatest] = useState(true);
    const [copied, setCopied] = useState(false);
    const [copyError, setCopyError] = useState('');
    const copyTimer = useRef(null);
    useEffect(() => () => clearTimeout(copyTimer.current), []);
    const rememberAnchor = () => {
        const element = box.current;
        const children = element?.children;
        if (!children?.length) return;
        const top = element.getBoundingClientRect().top;
        let low = 0, high = children.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (children[middle].getBoundingClientRect().bottom < top) low = middle + 1;
            else high = middle;
        }
        anchor.current = { id: children[low].dataset.logLine, offset: children[low].getBoundingClientRect().top - top };
    };
    useLayoutEffect(() => {
        const element = box.current;
        if (!element) return;
        if (following.current) element.scrollTop = element.scrollHeight;
        else if (anchor.current) {
            const line = element.querySelector(`[data-log-line="${anchor.current.id}"]`);
            if (line) element.scrollTop += line.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.current.offset;
            else element.scrollTop = 0;
            rememberAnchor();
        }
    }, [buffer]);
    const scroll = () => {
        const element = box.current;
        following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 24;
        setAtLatest(following.current);
        if (!following.current) rememberAnchor();
    };
    const latest = () => {
        following.current = true; setAtLatest(true); anchor.current = null;
        box.current.scrollTop = box.current.scrollHeight;
    };
    const copy = async () => {
        setCopyError('');
        try {
            await navigator.clipboard.writeText(buffer.text);
            setCopied(true); clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(false), 2000);
        } catch { setCopyError('Could not access the clipboard. Select log text and copy it normally.'); }
    };
    const lines = buffer.text.split('\n');
    if (buffer.text.endsWith('\n')) lines.pop();
    return <>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2 text-xs text-slate-500">
            <span role="status">{checkedAt ? `Last retrieved: ${new Date(checkedAt).toLocaleTimeString()}` : loading ? 'Loading logs…' : 'Waiting for logs'} · Live updates every 3 seconds{error && buffer.text ? ' · Showing last successful result' : ''}</span>
            <button onClick={copy} disabled={!buffer.text} className="border rounded px-2 py-1 text-blue-700 disabled:opacity-40">{copied ? 'Copied!' : 'Copy logs'}</button>
        </div>
        <p className="text-xs text-slate-500 mb-2">Up to 10,000 lines or 5 MB retained. Scroll up to read history; updates keep arriving.</p>
        {buffer.truncated && <p className="text-xs text-orange-700 mb-2">History limit reached; the oldest entries are removed as new logs arrive.</p>}
        {(error || copyError) && <p role="alert" className="text-sm text-red-700 mb-2">{error || copyError}</p>}
        <div className="relative">
            <div ref={box} role="region" aria-label={label} tabIndex={0} onScroll={scroll}
                className="h-80 overflow-auto whitespace-pre-wrap break-words bg-slate-950 text-slate-100 text-xs font-mono p-3 rounded">
                {buffer.text ? lines.map((line, index) => <div data-log-line={buffer.firstLine + index} key={buffer.firstLine + index}>{line || '\u00a0'}</div>) : loading ? 'Loading logs…' : error ? 'Logs unavailable.' : empty}
            </div>
            {!atLatest && buffer.text && <button onClick={latest} className="absolute bottom-3 right-4 rounded-full bg-blue-600 text-white px-3 py-1.5 text-xs shadow">↓ Latest</button>}
        </div>
    </>;
}
