import React from 'react';
import { MemoryRouter, Outlet, Routes, useLocation } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import devRoutes from './devRoutes';

vi.mock('./DevShell', () => ({ default: () => <Outlet /> }));
vi.mock('./DevHome', () => ({ default: () => <p>Dev home</p> }));
vi.mock('./LocalServices', () => ({ default: () => <p>Local services</p> }));
vi.mock('../discover/DiscoverPage', () => ({ default: () => <p>Discovery</p> }));
vi.mock('../deploy/DeployPage', () => ({ default: () => <p>Deploy</p> }));
vi.mock('../deploy/CleanupTab', () => ({ default: ({ fixedTarget }) => <p>Cleanup {fixedTarget}</p> }));
vi.mock('../deploy/BackupsTab', () => ({ default: () => <p>Laptop backups</p> }));
vi.mock('../eval/UIEval', () => ({ default: () => <p>Evaluation</p> }));
vi.mock('./ProductionPage', () => ({ default: ({ section = 'overview' }) => <p>Production {section}</p> }));
function Location() { const location = useLocation(); return <p data-testid="location">{location.pathname}{location.search}{location.hash}</p>; }
afterEach(cleanup);

it.each([
    ['/eval?tab=pdf-parser&file=example.pdf#page', '/dev/eval?tab=pdf-parser&file=example.pdf#page'],
    ['/discover?filter=pending', '/dev/discover?filter=pending'],
    ['/deploy?tab=production', '/prod'],
    ['/deploy?tab=backups', '/dev/backups'],
    ['/services', '/dev/services'],
])('keeps existing tool links working: %s', async (old, destination) => {
    render(<MemoryRouter initialEntries={[old]}><Location /><Routes>{devRoutes}</Routes></MemoryRouter>);
    expect(await screen.findByTestId('location')).toHaveTextContent(destination);
});
