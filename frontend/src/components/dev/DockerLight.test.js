/** The Docker light in the Dev bar, its restart, and the buttons that go grey while Docker is yellow or red. */
import React from 'react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import DevShell from './DevShell';
import DeployPage from '../deploy/DeployPage';
import DiscoverPage from '../discover/DiscoverPage';

let docker;      // what GET /deploy/docker answers
let posts;
let dockerCalls;
const OK = { status: 'ok', seconds: 0.4, message: 'docker ps answers in 0.4s.', checked_at: 't', active_run_id: null, active_kind: null, restarting: false };
const SLOW = { ...OK, status: 'slow', seconds: 6.2, message: 'docker ps took 6.2s. Docker is struggling.' };
const DOWN = { ...OK, status: 'down', seconds: 12, message: 'docker ps did not answer within 12s. Docker is stuck.' };

const FOLDER = { dir: 'Granth/A', runnable: true, pending: 2, counts: { not_indexed: 1, ocred: 1, indexed: 1 }, files: [] };

const mockServer = () => {
    posts = [];
    dockerCalls = 0;
    global.fetch = jest.fn(async (url, opts) => {
        const u = String(url);
        const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
        if (opts?.method === 'POST') { posts.push(u); return ok({ run_id: 'r1' }, 202); }
        if (u.includes('/deploy/docker')) { dockerCalls += 1; return ok(docker); }
        if (u.endsWith('/deploy/config')) return ok({ actions: [], build_services: ['cataloguesearch-api'], default_build_services: ['cataloguesearch-api'], prod_host: 'prod', build_env_file: '.env.local' });
        if (u.endsWith('/deploy/overview')) return ok({ opensearch: { reachable: true, indices: [] }, registry: { reachable: false, tags: [] }, tooling: null });
        if (u.endsWith('/deploy/compare')) return ok({ error: 'skipped in this test' });
        if (u.includes('/discover/status')) return ok({ categories: [{ name: 'Granth', counts: { not_indexed: 1, ocred: 1, indexed: 1 }, folders: [FOLDER] }], totals: { pending: 2, not_indexed: 1, ocred: 1, indexed: 1 } });
        if (u.includes('/deploy/gc/scan')) {
            const target = new URL(u, 'http://x').searchParams.get('target');
            return ok({
                target, label: target === 'prod' ? 'Prod' : 'This machine', generated_at: new Date().toISOString(),
                totals: { safe: 1_000_000_000, optional: 0 },
                categories: [{ id: 'dangling_images', title: 'Dangling images', description: 'd', safe: true, count: 2, size: 1_000_000_000, reclaimable: 1_000_000_000, items: [] }],
                volumes: null,
            });
        }
        if (u.includes('/jobs/runs/')) return ok({ steps: [{ name: 'restart', status: 'running', progress: { phase: { label: 'Starting OrbStack', index: 2, of: 4 } } }] });
        if (u.includes('/jobs/runs')) return ok({ runs: [], active_run_id: docker.active_run_id });
        return ok({});
    });
};

const renderAt = (path, element, entry = path) => render(
    <MemoryRouter initialEntries={[entry]}>
        <Routes><Route element={<DevShell />}><Route path={path} element={element} /></Route></Routes>
    </MemoryRouter>);
const light = () => screen.getByTestId('docker-light');
const settled = () => waitFor(() => expect(light().dataset.state).not.toBe('checking'));

beforeEach(() => { docker = OK; mockServer(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('the light', () => {
    test.each([
        [OK, 'ok', 'Docker'],
        [SLOW, 'slow', 'Docker slow · 6.2s'],
        [DOWN, 'down', 'Docker not responding'],
        [{ ...OK, restarting: true, active_run_id: 'r9', active_kind: 'docker' }, 'restarting', 'Restarting Docker…'],
    ])('shows %#: %s', async (info, state, text) => {
        docker = info;
        renderAt('/deploy', <div />);
        await waitFor(() => expect(light().dataset.state).toBe(state));
        expect(light()).toHaveTextContent(text);
    });

    test('says the dev server is unreachable instead of pretending Docker is fine', async () => {
        global.fetch = jest.fn(async () => { throw new Error('refused'); });
        renderAt('/deploy', <div />);
        await waitFor(() => expect(light().dataset.state).toBe('unknown'));
    });

    test('looks again every 15 seconds while green, and more often while it is not', async () => {
        jest.useFakeTimers();
        renderAt('/deploy', <div />);
        await act(async () => { await Promise.resolve(); });
        expect(dockerCalls).toBe(1);
        await act(async () => { jest.advanceTimersByTime(14000); });
        expect(dockerCalls).toBe(1);
        await act(async () => { jest.advanceTimersByTime(1500); });
        expect(dockerCalls).toBe(2);
        docker = DOWN;
        await act(async () => { jest.advanceTimersByTime(15000); });          // this poll sees red ...
        const seen = dockerCalls;
        await act(async () => { jest.advanceTimersByTime(6500); });           // ... and the next one comes sooner
        expect(dockerCalls).toBe(seen + 1);
    });
});

describe('restarting from the light', () => {
    const open = async () => { renderAt('/deploy', <div />); await settled(); fireEvent.click(light()); return screen.getByRole('dialog', { name: 'Docker' }); };

    test('shows why it is red and asks before restarting; nothing happens until confirmed', async () => {
        docker = DOWN;
        const pop = await open();
        expect(within(pop).getByTestId('docker-message')).toHaveTextContent('Docker is stuck');
        expect(pop).toHaveTextContent('switched off until Docker is healthy');
        fireEvent.click(within(pop).getByRole('button', { name: 'Restart Docker (OrbStack)' }));
        expect(pop).toHaveTextContent('Every local container, including the dev OpenSearch, stops');
        expect(posts).toEqual([]);
        fireEvent.click(within(pop).getByRole('button', { name: 'Cancel' }));
        expect(posts).toEqual([]);
        fireEvent.click(within(pop).getByRole('button', { name: 'Restart Docker (OrbStack)' }));
        fireEvent.click(within(pop).getByRole('button', { name: 'Yes, restart' }));
        await waitFor(() => expect(posts).toEqual(['/api/deploy/docker/restart']));
    });

    test('while it restarts, the popover says which step it is on', async () => {
        docker = { ...OK, restarting: true, active_run_id: 'r9', active_kind: 'docker' };
        const pop = await open();
        await waitFor(() => expect(within(pop).getByTestId('docker-message')).toHaveTextContent('Restarting… Starting OrbStack'));
        expect(within(pop).getByRole('button', { name: 'Restart Docker (OrbStack)' })).toBeDisabled();
    });

    test('cannot be restarted while another job runs, and says so', async () => {
        docker = { ...SLOW, active_run_id: 'deploy1', active_kind: 'deploy' };
        const pop = await open();
        expect(pop).toHaveTextContent('A job is running, so Docker cannot be restarted now');
        expect(within(pop).getByRole('button', { name: 'Restart Docker (OrbStack)' })).toBeDisabled();
    });

    test('a refused restart shows the server reason', async () => {
        docker = DOWN;
        const real = global.fetch;
        global.fetch = jest.fn(async (url, opts) => (opts?.method === 'POST'
            ? { ok: false, status: 409, json: async () => ({ detail: 'Run x is in progress. Cancel it first if you want to restart Docker now.' }) }
            : real(url, opts)));
        const pop = await open();
        fireEvent.click(within(pop).getByRole('button', { name: 'Restart Docker (OrbStack)' }));
        fireEvent.click(within(pop).getByRole('button', { name: 'Yes, restart' }));
        expect(await within(pop).findByRole('alert')).toHaveTextContent('Cancel it first');
    });

    test('the popover owns the Esc key, so Esc does not also leave full screen', async () => {
        const pop = await open();
        expect(pop).toHaveAttribute('data-esc-owner');
        expect(document.querySelector('[data-esc-owner]')).toBe(pop);        // what DevShell's Esc handler looks for
    });
});

describe('buttons go grey while Docker is yellow, red or restarting', () => {
    const runButtons = () => screen.getAllByRole('button', { name: 'Run' });

    test.each([['slow', SLOW], ['down', DOWN], ['restarting', { ...OK, restarting: true, active_run_id: 'r9', active_kind: 'docker' }]])(
        'Deploy: %s switches off Build and Deploy OpenSearch, with the reason', async (_n, info) => {
            docker = info;
            renderAt('/deploy', <DeployPage />);
            await screen.findByTestId('docker-blocked');
            runButtons().forEach((b) => expect(b).toBeDisabled());
            expect(runButtons()[0]).toHaveAttribute('title', expect.stringContaining('Restart it from the Docker light'));
        });

    test('Deploy: green leaves them on, and there is no notice', async () => {
        renderAt('/deploy', <DeployPage />);
        await settled();
        await waitFor(() => expect(runButtons()[0]).toBeEnabled());
        expect(screen.queryByTestId('docker-blocked')).toBeNull();
    });

    test('Deploy: comes back on by itself once Docker is green again', async () => {
        jest.useFakeTimers();
        docker = DOWN;
        renderAt('/deploy', <DeployPage />);
        await act(async () => { await Promise.resolve(); });
        await act(async () => { jest.advanceTimersByTime(100); });
        await waitFor(() => expect(runButtons()[0]).toBeDisabled());
        docker = OK;
        await act(async () => { jest.advanceTimersByTime(7000); });
        await waitFor(() => expect(runButtons()[0]).toBeEnabled());
        expect(screen.queryByTestId('docker-blocked')).toBeNull();
    });

    test('Discover: indexing, re-indexing and cleanup go off, OCR alone stays on', async () => {
        docker = DOWN;
        renderAt('/discover', <DiscoverPage />);
        await screen.findByTestId('docker-blocked');
        const folder = (await screen.findByText('Granth/A')).closest('div.border');
        await waitFor(() => expect(within(folder).getByRole('button', { name: 'Index' })).toBeDisabled());
        expect(within(folder).getByRole('button', { name: 'Re-index' })).toBeDisabled();
        expect(within(folder).getByRole('button', { name: /Cleanup/ })).toBeDisabled();
        expect(within(folder).getByRole('button', { name: 'OCR only' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Docker is not ready' })).toBeDisabled();
    });

    test('Discover: green leaves everything on', async () => {
        renderAt('/discover', <DiscoverPage />);
        const folder = (await screen.findByText('Granth/A')).closest('div.border');
        await settled();
        expect(within(folder).getByRole('button', { name: 'Index' })).toBeEnabled();
        expect(screen.queryByTestId('docker-blocked')).toBeNull();
    });

    test('Clean up: cleaning this machine goes off, cleaning prod (over ssh) stays on', async () => {
        docker = DOWN;
        renderAt('/deploy', <DeployPage />, '/deploy?tab=cleanup');
        const all = await screen.findByRole('button', { name: 'Docker is not ready' });
        expect(all).toBeDisabled();
        expect(screen.getByTestId('docker-blocked')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: /Prod/ }));
        expect(await screen.findByRole('button', { name: /Clean all safe/ })).toBeEnabled();
        expect(screen.queryByTestId('docker-blocked')).toBeNull();
    });

    test('Clean up: green leaves cleaning this machine on', async () => {
        renderAt('/deploy', <DeployPage />, '/deploy?tab=cleanup');
        expect(await screen.findByRole('button', { name: /Clean all safe/ })).toBeEnabled();
    });
});

