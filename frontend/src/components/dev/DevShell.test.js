import React from 'react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import DevShell, { useDevShell } from './DevShell';

let runs;
const mockApi = ({ offline = false } = {}) => {
    global.fetch = jest.fn(async () => {
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
                {['/dev', '/discover', '/deploy', '/eval'].map((p) => <Route key={p} path={p} element={<Page name={p} />} />)}
            </Route>
        </Routes>
    </MemoryRouter>);

const nav = () => screen.getByTestId('dev-nav');

beforeEach(() => {
    localStorage.clear();
    runs = { runs: [], active_run_id: null };
    mockApi();
});
afterEach(() => { jest.restoreAllMocks(); });

test('the Dev bar replaces the public site navigation: Home, Dev, Discover, Deploy, Eval', () => {
    renderAt('/discover');
    const links = within(nav()).getAllByRole('link').map((a) => a.textContent.replace(/\s+/g, ' ').trim());
    expect(links.slice(0, 5)).toEqual(['← Home', 'Dev LOCAL', 'Discover', 'Deploy', 'Eval']);
    expect(within(nav()).queryByText(/Ask AI|Aagam Khoj|Feedback/i)).not.toBeInTheDocument();
});

test('Home is the only way back to the regular site', () => {
    renderAt('/deploy');
    fireEvent.click(within(nav()).getByText('← Home'));
    expect(screen.getByTestId('site-home')).toBeInTheDocument();
});

test.each([
    ['/dev', 'Dev LOCAL'], ['/discover', 'Discover'], ['/deploy', 'Deploy'], ['/eval', 'Eval'],
])('on %s exactly one section is highlighted: %s', (path, label) => {
    renderAt(path);
    const active = within(nav()).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(active.map((a) => a.textContent.replace(/\s+/g, ' ').trim())).toEqual([label]);
});

test('the browser tab title follows the section', () => {
    const { unmount } = renderAt('/deploy');
    expect(document.title).toBe('Swalakshya · Deploy');
    unmount();
    renderAt('/eval');
    expect(document.title).toBe('Swalakshya · Eval');
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
        expect(pill).toHaveAttribute('href', '/discover');
    });

    test('a deploy links to the Deploy page', async () => {
        runs = { runs: [{ id: 'r2', kind: 'deploy', created_at: new Date().toISOString() }], active_run_id: 'r2' };
        renderAt('/discover');
        expect(await screen.findByTestId('job-pill')).toHaveAttribute('href', '/deploy');
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
