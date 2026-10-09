import React, { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, it, expect } from 'vitest';
import AccuracyModeSelect from './AccuracyModeSelect';

afterEach(cleanup);

it('shows a compact level and opens the shared effort popup to switch Low/High', () => {
    function Harness() {
        const [accuracy, setAccuracy] = useState(false);
        return <AccuracyModeSelect accuracyMode={accuracy} onChange={setAccuracy} />;
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Search effort' });
    expect(trigger.textContent).toContain('Low');
    expect(trigger.textContent).not.toContain('Effort');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Search effort' })).toBeTruthy();
    const slider = screen.getByRole('slider', { name: 'Search effort level' });
    expect(slider.value).toBe('0');
    fireEvent.change(slider, { target: { value: '1' } });
    expect(trigger.textContent).toContain('High');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(trigger.textContent).toContain('Low');
    fireEvent.keyDown(slider, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
});

it('uses a saved High default and disables selection during a request', () => {
    render(<AccuracyModeSelect accuracyMode onChange={() => {}} disabled />);
    const trigger = screen.getByRole('button', { name: 'Search effort' });
    expect(trigger.textContent).toContain('High');
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
});

it('dismisses the popup when clicking outside', () => {
    render(<AccuracyModeSelect onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search effort' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
});
