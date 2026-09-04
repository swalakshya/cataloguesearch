import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_PALETTE, PALETTES } from './palettes';

const MODE_KEY = 'ui_mode';
const PALETTE_KEY = 'ui_palette';

function getInitialMode() {
    try {
        const stored = localStorage.getItem(MODE_KEY);
        if (stored === 'light' || stored === 'dark') return stored;
    } catch {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialPalette() {
    // Was dev-only (no switcher UI existed in production to have set this
    // otherwise) — now exposed as a real Settings choice, so any saved value
    // applies regardless of environment.
    try {
        const stored = localStorage.getItem(PALETTE_KEY);
        if (stored && PALETTES[stored]) return stored;
    } catch {}
    return DEFAULT_PALETTE;
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
    const [mode, setModeState] = useState(getInitialMode);
    const [palette, setPaletteState] = useState(getInitialPalette);

    useEffect(() => {
        const tokens = PALETTES[palette]?.[mode] || PALETTES[DEFAULT_PALETTE][mode];
        const root = document.documentElement;
        Object.entries(tokens).forEach(([name, value]) => root.style.setProperty(name, value));
        root.classList.toggle('dark', mode === 'dark');
    }, [mode, palette]);

    // Direct setter (light|dark), not a flip — Settings' segmented pill picks a
    // side explicitly rather than toggling whatever the current value is.
    const setMode = useCallback((next) => {
        if (next !== 'light' && next !== 'dark') return;
        setModeState(next);
        try { localStorage.setItem(MODE_KEY, next); } catch {}
    }, []);

    const setPalette = useCallback((key) => {
        if (!PALETTES[key]) return;
        setPaletteState(key);
        try { localStorage.setItem(PALETTE_KEY, key); } catch {}
    }, []);

    const value = useMemo(() => ({ mode, setMode, palette, setPalette }), [mode, setMode, palette, setPalette]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
    return ctx;
}
