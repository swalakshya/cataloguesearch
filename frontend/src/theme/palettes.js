// Six candidate brand palettes, each with a light and dark variant. Status colors
// (success/warning/danger/info) are intentionally shared across every palette —
// they're functional signals, not brand identity, so keeping them fixed makes
// comparing palettes side-by-side cleaner.
//
// Pick one, set DEFAULT_PALETTE in ThemeContext.js to its key, and ship that.
// The dev-only PaletteSwitcher (never rendered in production) lets you preview
// all six live against the real app while it's being migrated onto these tokens.

const STATUS_COLORS = {
    light: {
        '--color-success': '#4B7A51',
        '--color-warning': '#A6791E',
        '--color-danger': '#A6402E',
        '--color-info': '#3D6E7A',
    },
    dark: {
        '--color-success': '#7FB285',
        '--color-warning': '#D2A94A',
        '--color-danger': '#E0806B',
        '--color-info': '#7FB8C4',
    },
};

export const PALETTES = {
    saffron: {
        label: 'Saffron & Parchment',
        description: 'Warm, devotional',
        light: {
            '--color-bg': '#FAF8F5',
            '--color-surface': '#FFFFFF',
            '--color-border': '#E8E1D8',
            '--color-ink': '#2A211A',
            '--color-ink-muted': '#6B5D52',
            '--color-brand': '#C4571C',
            '--color-brand-hover': '#A84812',
            ...STATUS_COLORS.light,
        },
        dark: {
            '--color-bg': '#1C1712',
            '--color-surface': '#262019',
            '--color-border': '#3A322A',
            '--color-ink': '#F2EAE1',
            '--color-ink-muted': '#B8AA9C',
            '--color-brand': '#E07A42',
            '--color-brand-hover': '#F0955F',
            ...STATUS_COLORS.dark,
        },
    },
    maroon: {
        label: 'Manuscript Maroon',
        description: 'Palm-leaf manuscript red-ochre pigment',
        light: {
            '--color-bg': '#FBF7F0',
            '--color-surface': '#FFFFFF',
            '--color-border': '#E6DCC8',
            '--color-ink': '#2B1A16',
            '--color-ink-muted': '#6E5850',
            '--color-brand': '#7A2E27',
            '--color-brand-hover': '#601F1A',
            ...STATUS_COLORS.light,
        },
        dark: {
            '--color-bg': '#1A1210',
            '--color-surface': '#241A17',
            '--color-border': '#3A2B26',
            '--color-ink': '#EDE2D8',
            '--color-ink-muted': '#B5A296',
            '--color-brand': '#B85248',
            '--color-brand-hover': '#CE6D62',
            ...STATUS_COLORS.dark,
        },
    },
    indigo: {
        label: 'Temple Indigo',
        description: 'Serene, contemplative, stone/tilework blue',
        light: {
            '--color-bg': '#F7F8FA',
            '--color-surface': '#FFFFFF',
            '--color-border': '#DEE2E8',
            '--color-ink': '#1B222E',
            '--color-ink-muted': '#5C6577',
            '--color-brand': '#33517A',
            '--color-brand-hover': '#253C5C',
            ...STATUS_COLORS.light,
        },
        dark: {
            '--color-bg': '#12161D',
            '--color-surface': '#1B212B',
            '--color-border': '#2C3644',
            '--color-ink': '#E4E8EF',
            '--color-ink-muted': '#A2ACBC',
            '--color-brand': '#6C8FBD',
            '--color-brand-hover': '#8AA8D0',
            ...STATUS_COLORS.dark,
        },
    },
    sandstone: {
        label: 'Sandstone Marble',
        description: 'Dilwara/Ranakpur carved marble & sandstone',
        light: {
            '--color-bg': '#FAF7F2',
            '--color-surface': '#FFFFFF',
            '--color-border': '#E7DDD0',
            '--color-ink': '#2E2620',
            '--color-ink-muted': '#71675C',
            '--color-brand': '#B06A45',
            '--color-brand-hover': '#935536',
            ...STATUS_COLORS.light,
        },
        dark: {
            '--color-bg': '#1D1813',
            '--color-surface': '#27201A',
            '--color-border': '#3D342B',
            '--color-ink': '#EEE6DB',
            '--color-ink-muted': '#B7AA9C',
            '--color-brand': '#D0906A',
            '--color-brand-hover': '#DFAA88',
            ...STATUS_COLORS.dark,
        },
    },
    forest: {
        label: 'Ahimsa Forest',
        description: 'Green primary, nature/non-violence',
        light: {
            '--color-bg': '#F7F9F5',
            '--color-surface': '#FFFFFF',
            '--color-border': '#DEE6D8',
            '--color-ink': '#1E251C',
            '--color-ink-muted': '#59634F',
            '--color-brand': '#3B6B3F',
            '--color-brand-hover': '#2C5230',
            ...STATUS_COLORS.light,
        },
        dark: {
            '--color-bg': '#131810',
            '--color-surface': '#1C2318',
            '--color-border': '#2E3928',
            '--color-ink': '#E4EBDF',
            '--color-ink-muted': '#A6B49B',
            '--color-brand': '#6E9E6C',
            '--color-brand-hover': '#8CB889',
            ...STATUS_COLORS.dark,
        },
    },
    charcoal: {
        label: 'Charcoal & Gold',
        description: 'Minimal, restrained, single-accent',
        light: {
            '--color-bg': '#F7F6F4',
            '--color-surface': '#FFFFFF',
            '--color-border': '#E2DFD9',
            '--color-ink': '#211F1C',
            '--color-ink-muted': '#625D55',
            '--color-brand': '#9C7A24',
            '--color-brand-hover': '#7E621B',
            ...STATUS_COLORS.light,
        },
        dark: {
            '--color-bg': '#171614',
            '--color-surface': '#201E1B',
            '--color-border': '#322F29',
            '--color-ink': '#ECE9E3',
            '--color-ink-muted': '#ADA69B',
            '--color-brand': '#D1A94F',
            '--color-brand-hover': '#E0BC6E',
            ...STATUS_COLORS.dark,
        },
    },
};

export const PALETTE_KEYS = Object.keys(PALETTES);

// Whichever palette wins the review gets set here — this is the one and only
// line that needs to change to lock in production's color scheme.
export const DEFAULT_PALETTE = 'saffron';
