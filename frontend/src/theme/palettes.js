// Candidate brand palettes, each with a light and dark variant. Status colors
// (success/warning/danger/info) are intentionally shared across every palette —
// they're functional signals, not brand identity, so keeping them fixed makes
// comparing palettes side-by-side cleaner.
//
// Pick one, set DEFAULT_PALETTE below, and ship that. The dev-only
// PaletteSwitcher (never rendered in production) lets you preview all of them
// live against the real app while it's being migrated onto these tokens.

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

// The sidebar lotus mark's own tint — a constant warm gold/copper identity
// that stays put across every palette, independent of whichever --color-brand
// accent is active. Keeps a subtle Jain visual identity even on the cooler,
// more corporate palettes (e.g. Cobalt Slate) where the UI accent itself
// isn't warm.
const MARK_COLORS = {
    light: { '--color-mark': '#B8860B' },
    dark: { '--color-mark': '#E0AF4F' },
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
            ...MARK_COLORS.light,
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
            ...MARK_COLORS.dark,
        },
    },
    vermilion: {
        label: 'Sindoor Vermilion',
        description: 'Fiery, auspicious tilak red',
        light: {
            '--color-bg': '#FBF6F2',
            '--color-surface': '#FFFFFF',
            '--color-border': '#F0DCD3',
            '--color-ink': '#2E1A15',
            '--color-ink-muted': '#7A5A4E',
            '--color-brand': '#D9351F',
            '--color-brand-hover': '#B52712',
            ...STATUS_COLORS.light,
            ...MARK_COLORS.light,
        },
        dark: {
            '--color-bg': '#1D1310',
            '--color-surface': '#271A16',
            '--color-border': '#402A22',
            '--color-ink': '#F5E6DE',
            '--color-ink-muted': '#C2A99C',
            '--color-brand': '#F0664A',
            '--color-brand-hover': '#F58868',
            ...STATUS_COLORS.dark,
            ...MARK_COLORS.dark,
        },
    },
    copper: {
        label: 'Amber Copper',
        description: 'Warm metallic copper, festive glow',
        light: {
            '--color-bg': '#FCF7F1',
            '--color-surface': '#FFFFFF',
            '--color-border': '#EFDFC9',
            '--color-ink': '#2C2013',
            '--color-ink-muted': '#79654E',
            '--color-brand': '#B5651D',
            '--color-brand-hover': '#935016',
            ...STATUS_COLORS.light,
            ...MARK_COLORS.light,
        },
        dark: {
            '--color-bg': '#1D1610',
            '--color-surface': '#28201A',
            '--color-border': '#45362A',
            '--color-ink': '#F2E5D5',
            '--color-ink-muted': '#C4AC90',
            '--color-brand': '#DE9046',
            '--color-brand-hover': '#E9AC6D',
            ...STATUS_COLORS.dark,
            ...MARK_COLORS.dark,
        },
    },
    sapphire: {
        label: 'Royal Sapphire',
        description: 'Rich cobalt blue, temple dome tilework',
        light: {
            '--color-bg': '#F5F8FC',
            '--color-surface': '#FFFFFF',
            '--color-border': '#D9E4F3',
            '--color-ink': '#16223A',
            '--color-ink-muted': '#52627E',
            '--color-brand': '#1E56C7',
            '--color-brand-hover': '#163F94',
            ...STATUS_COLORS.light,
            ...MARK_COLORS.light,
        },
        dark: {
            '--color-bg': '#0F1725',
            '--color-surface': '#1A2438',
            '--color-border': '#2A3854',
            '--color-ink': '#E4EAF6',
            '--color-ink-muted': '#9FADC9',
            '--color-brand': '#6D9BF2',
            '--color-brand-hover': '#93B7F5',
            ...STATUS_COLORS.dark,
            ...MARK_COLORS.dark,
        },
    },
    cobalt: {
        label: 'Cobalt Slate',
        description: 'Restrained, modern blue — technology-forward',
        light: {
            '--color-bg': '#F7F8FA',
            '--color-surface': '#FFFFFF',
            '--color-border': '#DFE3EA',
            '--color-ink': '#1B2430',
            '--color-ink-muted': '#5B6472',
            '--color-brand': '#2454B8',
            '--color-brand-hover': '#1B3E8C',
            ...STATUS_COLORS.light,
            ...MARK_COLORS.light,
        },
        dark: {
            '--color-bg': '#12161D',
            '--color-surface': '#1A2029',
            '--color-border': '#2C3542',
            '--color-ink': '#E7EBF1',
            '--color-ink-muted': '#9CA7B6',
            '--color-brand': '#6F97E0',
            '--color-brand-hover': '#95B3EA',
            ...STATUS_COLORS.dark,
            ...MARK_COLORS.dark,
        },
    },
};

export const PALETTE_KEYS = Object.keys(PALETTES);

// Whichever palette wins the review gets set here — this is the one and only
// line that needs to change to lock in production's color scheme.
export const DEFAULT_PALETTE = 'cobalt';
