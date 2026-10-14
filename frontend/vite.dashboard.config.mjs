import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

if (!process.env.DASHBOARD_OUTPUT || !process.env.DASHBOARD_RELEASE) {
    throw new Error('Build with your virtualenv: python dashboard.py --build');
}

export default defineConfig({
    plugins: [react()],
    // Do not inherit the application's .env.local API address (port 8001).
    // The dashboard UI and API always share port 4000.
    define: {
        'import.meta.env.REACT_APP_EVAL_API_BASE_URL': JSON.stringify('/api'),
        'import.meta.env.REACT_APP_STANDALONE_DASHBOARD': 'true',
    },
    base: `/dashboard-assets/${process.env.DASHBOARD_RELEASE}/`,
    build: {
        outDir: process.env.DASHBOARD_OUTPUT,
        emptyOutDir: true,
        assetsDir: 'static',
        rollupOptions: { input: 'dashboard.html' },
    },
});
