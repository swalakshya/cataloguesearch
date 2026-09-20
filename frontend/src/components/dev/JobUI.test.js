import React from 'react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import { FolderChecklist, RunPanel } from './JobUI';

const ITEMS = [
    { name: 'Granth/A', state: 'done', note: 'OCR complete' },
    { name: 'Granth/B', state: 'running' },
    { name: 'Granth/C', state: 'pending' },
    { name: 'Granth/D', state: 'submitted', note: 'LLM batch submitted' },
    { name: 'Granth/E', state: 'waiting', note: 'batch submitted 12m ago' },
    { name: 'Granth/F', state: 'failed', note: 'exit 1' },
    { name: 'Granth/G', state: 'skipped', note: 'already OCRed' },
];

test('shows every folder with its state, using the note when there is one', () => {
    render(<FolderChecklist items={ITEMS} />);
    const rows = within(screen.getByTestId('folder-checklist')).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['done', 'running', 'pending', 'submitted', 'waiting', 'failed', 'skipped']);
    expect(screen.getByText('OCR complete')).toBeInTheDocument();
    expect(screen.getByText('batch submitted 12m ago')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();     // no note -> the state name
    expect(screen.getByText('queued')).toBeInTheDocument();
});

test('a single folder needs no checklist', () => {
    const { container } = render(<FolderChecklist items={[ITEMS[0]]} />);
    expect(container).toBeEmptyDOMElement();
    expect(render(<FolderChecklist items={undefined} />).container).toBeEmptyDOMElement();
});

const jobsWith = (step, runStatus = 'running') => ({
    selectedRun: { id: 'r1', status: runStatus, created_at: new Date().toISOString(), steps: [step] },
    selectedStep: step.name, activeRunId: runStatus === 'running' ? 'r1' : null, nowMs: Date.now(), busy: runStatus === 'running',
    pickStep: () => {}, cancel: () => {},
});
const ocrStep = (status) => ({
    name: 'ocr', title: 'OCR (7 folders)', status, started_at: new Date().toISOString(), finished_at: null,
    progress: { phase: { label: 'OCR · Granth/B', done: 1, total: 7, unit: 'folders', items: ITEMS }, sub: null },
});

test('a running step shows the bar and the per-folder list', () => {
    render(<MemoryRouter><RunPanel jobs={jobsWith(ocrStep('running'))} /></MemoryRouter>);
    expect(screen.getByText('OCR · Granth/B: 1 of 7 folders')).toBeInTheDocument();
    expect(screen.getByTestId('folder-checklist')).toBeInTheDocument();
});

test('a finished step keeps its per-folder outcome (so you can see which folder was waiting or failed)', () => {
    const step = { ...ocrStep('waiting'), finished_at: new Date().toISOString() };
    render(<MemoryRouter><RunPanel jobs={jobsWith(step, 'waiting')} /></MemoryRouter>);
    expect(screen.getByTestId('folder-checklist')).toBeInTheDocument();
    expect(screen.queryByText(/of 7 folders/)).not.toBeInTheDocument();      // the live bar is only for running steps
});

test('a step that has not started shows no checklist', () => {
    const step = { name: 'index', title: 'Index', status: 'pending', progress: null };
    render(<MemoryRouter><RunPanel jobs={jobsWith(step)} /></MemoryRouter>);
    expect(screen.queryByTestId('folder-checklist')).not.toBeInTheDocument();
});
