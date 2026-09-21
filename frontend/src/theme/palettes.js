// Brand palettes, each with a light and dark variant. Status colors
// (success/warning/danger/info) are intentionally shared across every palette —
// they're functional signals, not brand identity, so keeping them fixed makes
// comparing palettes side-by-side cleaner.
//
// User-selectable via the Settings panel (see SettingsModal.js); DEFAULT_PALETTE
// below is only the first-run default before anyone has chosen for themselves.

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

// Fill for the user's chat bubble and the ink used on --color-brand fills.
// Defaults keep the classic look (brand-filled bubble, white ink); softer
// palettes override both. Every palette must set these explicitly because
// ThemeContext never unsets a variable when switching palettes.
const CLASSIC_FILL = { '--color-bubble': 'var(--color-brand)', '--color-bubble-ink': '#FFFFFF', '--color-on-brand': '#FFFFFF', '--color-quote-bg': 'color-mix(in srgb, var(--color-brand) 4%, var(--color-surface))' };

export const PALETTES = {
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
            ...CLASSIC_FILL,
        },
        dark: {
            '--color-bg': '#312421',
            '--color-surface': '#3F2F2A',
            '--color-border': '#59433B',
            '--color-ink': '#F5E6DE',
            '--color-ink-muted': '#D6BDB0',
            '--color-brand': '#F77A60',
            '--color-brand-hover': '#F99A82',
            ...STATUS_COLORS.dark,
            ...MARK_COLORS.dark,
            ...CLASSIC_FILL,
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
            ...CLASSIC_FILL,
        },
        dark: {
            '--color-bg': '#1D2535',
            '--color-surface': '#252F44',
            '--color-border': '#344360',
            '--color-ink': '#E4EAF6',
            '--color-ink-muted': '#AFBDD9',
            '--color-brand': '#6D9BF2',
            '--color-brand-hover': '#93B7F5',
            ...STATUS_COLORS.dark,
            ...MARK_COLORS.dark,
            ...CLASSIC_FILL,
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
            ...CLASSIC_FILL,
        },
        dark: {
            '--color-bg': '#202632',
            '--color-surface': '#293240',
            '--color-border': '#3B4759',
            '--color-ink': '#E7EBF1',
            '--color-ink-muted': '#B8C3D2',
            '--color-brand': '#82A6E8',
            '--color-brand-hover': '#A6C0EE',
            ...STATUS_COLORS.dark,
            ...MARK_COLORS.dark,
            ...CLASSIC_FILL,
        },
    },
    // Paper White: pure white page, graphite ink (deliberately not pure black),
    // and no solid-black blocks — the user's bubble is a soft grey card and the
    // accent is a muted slate that only shows on small controls.
    paper: {
        label: 'Paper White',
        description: 'Pure white, graphite ink — plain and crisp',
        light: {
            '--color-bg': '#FFFFFF',
            '--color-surface': '#FFFFFF',
            '--color-border': '#D8D9DC',
            '--color-ink': '#222325',
            '--color-ink-muted': '#52565D',
            '--color-brand': '#3D4552',
            '--color-brand-hover': '#293039',
            '--color-bubble': '#F1F2F4',
            '--color-quote-bg': '#FFFFFF',
            '--color-bubble-ink': '#222325',
            '--color-on-brand': '#FFFFFF',
            ...STATUS_COLORS.light,
            ...MARK_COLORS.light,
        },
        dark: {
            '--color-bg': '#26282C',
            '--color-surface': '#2E3035',
            '--color-border': '#43464D',
            '--color-ink': '#E8E9EB',
            '--color-ink-muted': '#B8BDC5',
            '--color-brand': '#B4BCCB',
            '--color-brand-hover': '#CBD2DD',
            '--color-bubble': '#363940',
            '--color-quote-bg': '#2E3035',
            '--color-bubble-ink': '#E8E9EB',
            '--color-on-brand': '#14161A',
            ...STATUS_COLORS.dark,
            ...MARK_COLORS.dark,
        },
    },
    // Ayu Light / Ayu Dark. Ink and muted are a notch stronger than stock Ayu
    // (whose greys are low-contrast); the bubble is a soft tint, not a solid fill.
    ayu: {
        label: 'Ayu',
        description: 'Ayu Light / Ayu Dark — warm amber accent',
        light: {
            '--color-bg': '#FCFCFC',
            '--color-surface': '#FFFFFF',
            '--color-border': '#E4E6E9',
            '--color-ink': '#2B3036',
            '--color-ink-muted': '#4D555B',
            '--color-brand': '#B45309',
            '--color-brand-hover': '#8F4207',
            '--color-bubble': '#FBEBD6',
            '--color-quote-bg': 'color-mix(in srgb, #B45309 4%, #FFFFFF)',
            '--color-bubble-ink': '#2B3036',
            '--color-on-brand': '#FFFFFF',
            ...STATUS_COLORS.light,
            ...MARK_COLORS.light,
        },
        dark: {
            '--color-bg': '#1D2535',
            '--color-surface': '#273141',
            '--color-border': '#3B4558',
            '--color-ink': '#E6E1CF',
            '--color-ink-muted': '#BAC1CC',
            '--color-brand': '#E6B450',
            '--color-brand-hover': '#F0C674',
            '--color-bubble': '#2D3953',
            '--color-quote-bg': '#273141',
            '--color-bubble-ink': '#E6E1CF',
            '--color-on-brand': '#0B0E14',
            ...STATUS_COLORS.dark,
            ...MARK_COLORS.dark,
        },
    },
};

export const PALETTE_KEYS = Object.keys(PALETTES);

// Whichever palette wins the review gets set here — this is the one and only
// line that needs to change to lock in production's color scheme.
export const DEFAULT_PALETTE = 'ayu';
