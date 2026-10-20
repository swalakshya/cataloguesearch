import { mergeConfig } from 'vite';
import normal from './vite.config.mjs';
import Reporter from '../deploy/testing/vitest_reporter.mjs';
export default (env) => mergeConfig(normal(env), {
    test: {
        reporters: ['default', new Reporter()],
        coverage: {
            enabled: true, provider: 'v8', include: ['src/**/*.{js,jsx}'],
            exclude: ['src/**/*.test.{js,jsx}', 'src/setupTests.js'],
            reporter: ['json', 'json-summary', 'lcov', 'html'], reportOnFailure: true,
            reportsDirectory: process.env.DASHBOARD_TEST_COVERAGE || './coverage',
        },
    },
});
