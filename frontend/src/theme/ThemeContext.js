import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_PALETTE, PALETTES } from './palettes';

const MODE_KEY = 'ui_mode';
const PALETTE_KEY = 'ui_palette';

// Exported so App.js can re-derive these on logout, to snap the UI back to
// true offline state immediately rather than leaving the previous account's
// in-memory values on screen until a refresh.
export function getInitialMode() {
    try {
        const stored = localStorage.getItem(MODE_KEY);
        if (stored === 'light' || stored === 'dark') return stored;
    } catch {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// The app's hardcoded default (system color-scheme preference), with no
// localStorage involved at all — used to seed a logged-in user who has no
// saved server settings yet, rather than falling back to whatever this
// browser happens to have stored locally.
export function getSystemDefaultMode() {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getInitialPalette() {
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

    // Pure in-memory setters — persistence is the caller's job (SettingsModal
    // decides whether to write localStorage or sync to the server, see
    // setStoredMode/setStoredPalette below), not something baked in here.
    // Direct setter (light|dark), not a flip — Settings' segmented pill picks a
    // side explicitly rather than toggling whatever the current value is.
    const setMode = useCallback((next) => {
        if (next !== 'light' && next !== 'dark') return;
        setModeState(next);
    }, []);

    const setPalette = useCallback((key) => {
        if (!PALETTES[key]) return;
        setPaletteState(key);
    }, []);

    const value = useMemo(() => ({ mode, setMode, palette, setPalette }), [mode, setMode, palette, setPalette]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// Offline-mode (logged-out) persistence — kept as standalone exports rather
// than baked into setMode/setPalette so login-mode saves (which persist to
// the server instead) don't have to fight or bypass them. Mirrors
// chatConfig.js's setStoredAnswerFormat shape.
export function setStoredMode(next) {
    if (next !== 'light' && next !== 'dark') return;
    try { localStorage.setItem(MODE_KEY, next); } catch {}
}

export function setStoredPalette(key) {
    if (!PALETTES[key]) return;
    try { localStorage.setItem(PALETTE_KEY, key); } catch {}
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
    return ctx;
}
