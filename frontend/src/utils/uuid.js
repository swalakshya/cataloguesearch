// crypto.randomUUID() only exists in secure contexts (HTTPS or localhost). Opening the dev server by LAN IP over plain
// HTTP (e.g. http://192.168.1.137:3000) leaves it undefined, which used to crash the whole app at import time.
// crypto.getRandomValues() is available everywhere, so build a standard v4 UUID from it when needed.
export function randomUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
