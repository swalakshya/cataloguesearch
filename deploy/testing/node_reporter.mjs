import fs from 'node:fs';
import path from 'node:path';
import { emit, relative, errors } from './events.mjs';
export default async function* reporter(events) {
    for await (const { type, data: d } of events) {
        const file = relative(d.entryFile || d.file);
        if (type === 'test:dequeue') emit(file, 'start');
        if (type === 'test:stdout' || type === 'test:stderr') emit(file, 'log', { text: d.message });
        if (type === 'test:diagnostic') emit(file, 'log', { text: d.message });
        if (type === 'test:complete' && d.entryFile && d.details?.type !== 'suite') {
            emit(file, 'test', { test: `${d.testId}: ${d.name}`, status: d.details.error?.failureType === 'testSkipped' || d.skip || d.todo ? 'skipped' : d.details.passed ? 'passed' : 'failed', duration: (d.details.duration_ms || 0) / 1000, text: errors([d.details.error].filter(Boolean)) });
        }
        if (type === 'test:fail' && !d.entryFile && d.file) emit(file, 'error', { text: errors([d.details?.error].filter(Boolean)) });
        if (type === 'test:summary' && d.entryFile) emit(file, 'finish');
        if (type === 'test:coverage') fs.writeFileSync(path.join(process.env.DASHBOARD_TEST_OUTPUT, 'chat', 'node-coverage.json'), JSON.stringify(d.summary));
        if (type === 'test:summary' && !d.file && !d.entryFile) yield `Chat: ${d.counts?.passed || 0} passed, ${d.counts?.failed || 0} failed\n`;
    }
}
