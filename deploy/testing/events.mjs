import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const directory = process.env.DASHBOARD_TEST_OUTPUT;
const suite = process.env.DASHBOARD_TEST_SUITE;
const secrets = Object.entries(process.env).filter(([key, value]) => /key|secret|token|password|credential/i.test(key) && value.length >= 4).map(([, v]) => v);
export function clean(text) {
    text = String(text);
    for (const secret of secrets) text = text.split(secret).join('[masked]');
    return text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [masked]');
}
export function relative(file) { return file ? path.relative(process.cwd(), file).split(path.sep).join('/') : '__setup__'; }
export function emit(file, kind, payload = {}) {
    if (!directory) return;
    const id = crypto.createHash('sha256').update(`${suite}:${file}`).digest('hex').slice(0, 24);
    if (payload.text) {
        payload.text = clean(payload.text);
        const log = path.join(directory, `${id}.log`);
        if (fs.existsSync(log) && fs.statSync(log).size > 5000000) {
            const fd = fs.openSync(log, 'r');
            const bytes = Buffer.alloc(2500000);
            fs.readSync(fd, bytes, 0, bytes.length, fs.statSync(log).size - bytes.length);
            fs.closeSync(fd); fs.writeFileSync(log, bytes);
        }
        fs.appendFileSync(log, payload.text.slice(-1000000) + '\n');
        payload.text = ['test', 'error'].includes(kind) ? payload.text.slice(0, 16000) : '';
    }
    fs.appendFileSync(path.join(directory, `events-${suite}.jsonl`), JSON.stringify({ suite, path: file, kind, ...payload }) + '\n');
}
export function errors(items) { return (items || []).map(e => e.stack || e.message || String(e)).join('\n'); }
