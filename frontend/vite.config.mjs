import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Resolve dev routes only when enabled. Production Docker builds omit these
// folders entirely, so a static import of their real path would break the build.
export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, process.cwd(), 'REACT_APP_');
    const devTools = command === 'serve' || env.REACT_APP_DEV_TOOLS === 'true';
    const devRoutesId = '\0virtual:dev-routes';
    return {
        envPrefix: 'REACT_APP_',
        plugins: [
            react(),
            {
                name: 'dev-routes',
                resolveId(id) {
                    if (id === 'virtual:dev-routes') return devRoutesId;
                },
                load(id) {
                    if (id !== devRoutesId) return;
                    if (!devTools) return 'export default null;';
                    const routes = fileURLToPath(new URL('./src/components/dev/devRoutes.jsx', import.meta.url));
                    return `export { default } from ${JSON.stringify(routes)};`;
                },
            },
        ],
        server: {
            port: Number(process.env.PORT || 3000),
            strictPort: true,
            open: process.env.BROWSER !== 'none',
        },
        build: {
            outDir: 'build',
            assetsDir: 'static',
        },
        test: {
            environment: 'jsdom',
            globals: true,
            setupFiles: ['./src/setupTests.js'],
            include: ['src/**/*.test.{js,jsx}'],
        },
    };
});
