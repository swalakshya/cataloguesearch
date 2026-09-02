import React, { useState } from 'react';
import { Moon, Palette, Sun, X } from 'lucide-react';
import { PALETTES, PALETTE_KEYS } from './palettes';
import { useTheme } from './ThemeContext';

// Dev-only tool for comparing the 6 candidate palettes live. Never rendered in
// production — App.js only mounts this when process.env.NODE_ENV === 'development'.
export default function PaletteSwitcher() {
    const { mode, toggleMode, palette, setPalette } = useTheme();
    const [open, setOpen] = useState(false);

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                title="Open palette switcher (dev only)"
                style={{
                    position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
                    width: 40, height: 40, borderRadius: '9999px',
                    background: 'var(--color-brand)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                }}
            >
                <Palette size={18} />
            </button>
        );
    }

    const badge = (label, colorVar) => (
        <span
            style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999,
                color: `var(${colorVar})`, background: 'var(--color-bg)',
                border: `1px solid var(${colorVar})`,
            }}
        >
            {label}
        </span>
    );

    return (
        <div
            style={{
                position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
                width: 260, borderRadius: 12, padding: 12,
                background: 'var(--color-surface)', color: 'var(--color-ink)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                fontFamily: 'sans-serif', fontSize: 13,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>Palette (dev only)</span>
                <div style={{ display: 'flex', gap: 4 }}>
                    <button
                        onClick={toggleMode}
                        title="Toggle light/dark"
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-ink-muted)', padding: 2 }}
                    >
                        {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                    </button>
                    <button
                        onClick={() => setOpen(false)}
                        title="Hide"
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-ink-muted)', padding: 2 }}
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Live preview — sample components styled purely from tokens, so a
                palette can be judged before any real page is migrated onto them. */}
            <div
                style={{
                    marginBottom: 10, padding: 10, borderRadius: 8,
                    background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                }}
            >
                <div style={{ fontWeight: 600, marginBottom: 2 }}>Sample card</div>
                <div style={{ color: 'var(--color-ink-muted)', marginBottom: 8 }}>Muted supporting text</div>
                <button
                    style={{
                        border: 'none', borderRadius: 6, padding: '6px 12px', color: '#fff',
                        background: 'var(--color-brand)', fontWeight: 600, cursor: 'default',
                        marginBottom: 8,
                    }}
                >
                    Primary action
                </button>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {badge('Success', '--color-success')}
                    {badge('Warning', '--color-warning')}
                    {badge('Danger', '--color-danger')}
                    {badge('Info', '--color-info')}
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {PALETTE_KEYS.map((key) => {
                    const p = PALETTES[key];
                    const active = key === palette;
                    return (
                        <button
                            key={key}
                            onClick={() => setPalette(key)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '6px 8px', borderRadius: 8, textAlign: 'left',
                                border: active ? '1px solid var(--color-brand)' : '1px solid transparent',
                                background: active ? 'var(--color-bg)' : 'transparent',
                                cursor: 'pointer', color: 'inherit',
                            }}
                        >
                            <span
                                style={{
                                    width: 16, height: 16, borderRadius: '9999px', flexShrink: 0,
                                    background: p.light['--color-brand'],
                                    border: '1px solid var(--color-border)',
                                }}
                            />
                            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                                <span style={{ fontWeight: active ? 600 : 400 }}>{p.label}</span>
                                <span style={{ fontSize: 11, color: 'var(--color-ink-muted)' }}>{p.description}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
