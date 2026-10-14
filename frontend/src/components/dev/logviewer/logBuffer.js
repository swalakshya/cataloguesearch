export const MAX_LINES = 10000;
export const MAX_BYTES = 5 * 1024 * 1024;
export const emptyBuffer = () => ({ text: '', firstLine: 0, truncated: false });
const newlines = text => { let count = 0; for (const char of text) if (char === '\n') count += 1; return count; };

export function appendLogs(previous, payload, maxLines = MAX_LINES, maxBytes = MAX_BYTES) {
    let text = previous.text + (payload.reset && previous.text ? '\n[Log source restarted]\n' : '') + payload.text;
    let firstLine = previous.firstLine;
    let truncated = previous.truncated || Boolean(payload.truncated);
    const encoded = new TextEncoder().encode(text);
    if (encoded.length > maxBytes) {
        let start = encoded.length - maxBytes;
        while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) start += 1;
        let tail = new TextDecoder().decode(encoded.subarray(start));
        const boundary = tail.indexOf('\n');
        if (boundary >= 0) tail = tail.slice(boundary + 1);
        firstLine += newlines(text) - newlines(tail);
        text = tail;
        truncated = true;
    }
    let remaining = maxLines;
    for (let index = text.length - 1 - Number(text.endsWith('\n')); index >= 0; index -= 1) {
        if (text[index] === '\n' && --remaining === 0) {
            firstLine += newlines(text.slice(0, index + 1));
            text = text.slice(index + 1);
            truncated = true;
            break;
        }
    }
    return { text, firstLine, truncated };
}
