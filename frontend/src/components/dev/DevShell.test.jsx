import React from 'react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import DevShell, { useDevShell } from './DevShell';

let runs;
const mockApi = ({ offline = false } = {}) => {
    global.fetch = vi.fn(async () => {
        if (offline) throw new Error('connection refused');
        return { ok: true, status: 200, json: async () => runs };
    });
};

function Page({ name }) {
    const { focus, setFocus } = useDevShell();
    return <div><span data-testid="page">{name}</span><span data-testid="focus">{String(focus)}</span><button onClick={() => setFocus(true)}>go focus</button></div>;
}

const renderAt = (path) => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="/" element={<div data-testid="site-home">regular home</div>} />
            <Route element={<DevShell />}>
                {['/dev', '/discover', '/deploy', '/eval', '/dev/services', '/dev/discover', '/dev/deploy', '/dev/cleanup', '/dev/eval', '/prod', '/prod/services'].map((p) => <Route key={p} path={p} element={<Page name={p} />} />)}
            </Route>
        </Routes>
    </MemoryRouter>);

const nav = () => screen.getByTestId('dev-nav');

beforeEach(() => {
    localStorage.clear();
    runs = { runs: [], active_run_id: null };
    mockApi();
});
afterEach(() => { vi.restoreAllMocks(); });

test('the dashboard separates Dev and Prod, with local tools beneath Dev', () => {
    renderAt('/dev/discover');
    const environment = within(nav()).getByRole('navigation', { name: 'Environment' });
    expect(within(environment).getByRole('link', { name: 'Dev' })).toHaveAttribute('aria-current', 'page');
    expect(within(environment).getByRole('link', { name: 'Prod' })).not.toHaveAttribute('aria-current');
    const tools = within(nav()).getByRole('navigation', { name: 'Dev tools' });
    expect(within(tools).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/dev/services', '/dev/tests', '/dev/discover', '/dev/deploy', '/dev/cleanup', '/dev/eval']);
});

test('Home is the only way back to the regular site', () => {
    renderAt('/deploy');
    fireEvent.click(within(nav()).getByText('← Home'));
    expect(screen.getByTestId('site-home')).toBeInTheDocument();
});

test.each([
    ['/dev/services', 'Local services'], ['/dev/discover', 'Discovery'], ['/dev/deploy', 'Deploy'], ['/dev/eval', 'Eval tools'],
])('on %s the correct Dev tool is highlighted: %s', (path, label) => {
    renderAt(path);
    const tools = within(nav()).getByRole('navigation', { name: 'Dev tools' });
    expect(within(tools).getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    expect(within(tools).getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'page')).toHaveLength(1);
});

test('Prod has separate service, certificate, backup, cleanup and host sections', () => {
    renderAt('/prod/services');
    const tools = within(nav()).getByRole('navigation', { name: 'Prod tools' });
    expect(within(tools).getByRole('link', { name: 'Services' })).toHaveAttribute('aria-current', 'page');
    expect(within(tools).getByRole('link', { name: 'Cleanup' })).toHaveAttribute('href', '/prod/cleanup');
    expect(within(tools).queryByRole('link', { name: 'Local services' })).toBeNull();
});

test('the browser tab title follows the section', () => {
    const { unmount } = renderAt('/deploy');
    expect(document.title).toBe('Swalakshya · Dev · Deploy');
    unmount();
    renderAt('/eval');
    expect(document.title).toBe('Swalakshya · Dev · Eval tools');
});

test('the shell supplies the card colours the Eval tools rely on, and scrolls everything but Eval itself', () => {
    const { unmount } = renderAt('/discover');
    const root = screen.getByTestId('dev-main').parentElement;
    expect(root.style.getPropertyValue('--bg-card')).toBe('var(--color-surface)');
    expect(root.style.getPropertyValue('--bg-surface')).toBe('var(--color-bg)');
    expect(screen.getByTestId('dev-main').className).toMatch(/overflow-auto/);
    unmount();
    renderAt('/eval');
    expect(screen.getByTestId('dev-main').className).toMatch(/overflow-hidden/);   // Eval manages its own scrolling
});

describe('running-job pill', () => {
    test('shows the running job from any page and links to it', async () => {
        runs = { runs: [{ id: 'r1', kind: 'discover', created_at: new Date(Date.now() - 12 * 60000).toISOString() }], active_run_id: 'r1' };
        renderAt('/eval');
        const pill = await screen.findByTestId('job-pill');
        expect(pill).toHaveTextContent('Discover running · 12m');
        expect(pill).toHaveAttribute('href', '/dev/discover');
    });

    test('a deploy links to the Deploy page', async () => {
        runs = { runs: [{ id: 'r2', kind: 'deploy', params: { actions: ['build'] }, created_at: new Date().toISOString() }], active_run_id: 'r2' };
        renderAt('/discover');
        expect(await screen.findByTestId('job-pill')).toHaveAttribute('href', '/dev/deploy');
    });

    test('nothing when idle', async () => {
        renderAt('/discover');
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        expect(screen.queryByTestId('job-pill')).not.toBeInTheDocument();
    });

    test('says so when the dev server is not reachable', async () => {
        mockApi({ offline: true });
        renderAt('/discover');
        expect(await screen.findByText(/dev server offline/)).toBeInTheDocument();
    });
});

describe('full screen (focus) mode', () => {
    test('hides the Dev bar on Eval, and the choice is remembered', async () => {
        renderAt('/eval');
        expect(nav()).toBeInTheDocument();
        fireEvent.click(screen.getByText('go focus'));
        expect(screen.queryByTestId('dev-nav')).not.toBeInTheDocument();
        expect(screen.getByTestId('focus')).toHaveTextContent('true');
        expect(localStorage.getItem('eval_focus')).toBe('1');
    });

    test('is applied on Eval only: the other pages always keep their bar', () => {
        localStorage.setItem('eval_focus', '1');
        const { unmount } = renderAt('/discover');
        expect(nav()).toBeInTheDocument();
        expect(screen.getByTestId('focus')).toHaveTextContent('false');
        unmount();
        renderAt('/eval');
        expect(screen.queryByTestId('dev-nav')).not.toBeInTheDocument();
    });

    test('Esc brings the bar back, unless a dialog or popover owns the key', () => {
        localStorage.setItem('eval_focus', '1');
        const { container } = renderAt('/eval');
        const owner = document.createElement('div');
        owner.setAttribute('role', 'dialog');
        container.appendChild(owner);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByTestId('dev-nav')).not.toBeInTheDocument();          // the dialog keeps Esc
        container.removeChild(owner);
        const popover = document.createElement('div');
        popover.setAttribute('data-esc-owner', '');
        container.appendChild(popover);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByTestId('dev-nav')).not.toBeInTheDocument();          // so does a popover / menu
        container.removeChild(popover);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(nav()).toBeInTheDocument();
        expect(localStorage.getItem('eval_focus')).toBe('0');
    });
});
