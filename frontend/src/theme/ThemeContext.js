import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_PALETTE, PALETTES } from './palettes';

const MODE_KEY = 'ui_mode';
const PALETTE_KEY = 'ui_palette';
const isDev = process.env.NODE_ENV === 'development';

function getInitialMode() {
    try {
        const stored = localStorage.getItem(MODE_KEY);
        if (stored === 'light' || stored === 'dark') return stored;
    } catch {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialPalette() {
    // The palette override only ever applies in development — production always
    // uses DEFAULT_PALETTE, since there's no switcher UI to have set it otherwise.
    if (isDev) {
        try {
            const stored = localStorage.getItem(PALETTE_KEY);
            if (stored && PALETTES[stored]) return stored;
        } catch {}
    }
    return DEFAULT_PALETTE;
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
    const [mode, setMode] = useState(getInitialMode);
    const [palette, setPaletteState] = useState(getInitialPalette);

    useEffect(() => {
        const tokens = PALETTES[palette]?.[mode] || PALETTES[DEFAULT_PALETTE][mode];
        const root = document.documentElement;
        Object.entries(tokens).forEach(([name, value]) => root.style.setProperty(name, value));
        root.classList.toggle('dark', mode === 'dark');
    }, [mode, palette]);

    const toggleMode = useCallback(() => {
        setMode(prev => {
            const next = prev === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem(MODE_KEY, next); } catch {}
            return next;
        });
    }, []);

    const setPalette = useCallback((key) => {
        if (!isDev || !PALETTES[key]) return;
        setPaletteState(key);
        try { localStorage.setItem(PALETTE_KEY, key); } catch {}
    }, []);

    const value = useMemo(() => ({ mode, toggleMode, palette, setPalette }), [mode, toggleMode, palette, setPalette]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
    return ctx;
}
