// Turns a file's scan_config (GET /eval/ocr/scan-config) into PDF Parser's control values, so opening a library
// file shows the settings that processing will actually use. Anything the config doesn't set falls back to the
// same default the controls start with, so the controls always describe the current file.

export const LLM_MODELS = [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
];

export const DEFAULT_CONTROLS = {
    mode: 'tesseract',
    language: 'hin',
    dhundhari: false,
    modelName: 'gemini-2.5-flash',
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
    multiPage: false,
    splitPct: 50,
};

const LANG_ALIASES = { hi: 'hi', hin: 'hi', hindi: 'hi', gu: 'gu', guj: 'gu', gujarati: 'gu' };

// scan_config language -> the language toggle value ('hin' | 'guj' | 'guj+hin') plus the Dhundhari checkbox.
// "dhundhari" is Hindi with the Dhundhari->Hindi option on. The toggle has one mixed setting, so any
// Hindi+Gujarati mix (in either order) maps to 'guj+hin'.
export function languageControls(raw) {
    const value = String(raw || 'hi').toLowerCase().replace(/\s+/g, '');
    if (value === 'dhundhari') return { language: 'hin', dhundhari: true };
    const langs = [...new Set(value.split('+').map((p) => LANG_ALIASES[p]).filter(Boolean))];
    if (langs.length === 0) return { language: 'hin', dhundhari: false };
    if (langs.length > 1) return { language: 'guj+hin', dhundhari: false };
    return { language: langs[0] === 'gu' ? 'guj' : 'hin', dhundhari: false };
}

const pct = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 0; // the crop inputs allow 0-50
};

export function scanConfigToControls(cfg) {
    const c = cfg || {};
    const crop = c.crop || {};
    const { language, dhundhari } = languageControls(c.language);
    const split = Number(c.split_percentage);
    return {
        mode: c.ocr_engine === 'llm' ? 'llm' : 'tesseract',
        language,
        dhundhari,
        modelName: LLM_MODELS.some((m) => m.value === c.llm_model) ? c.llm_model : DEFAULT_CONTROLS.modelName,
        crop: { top: pct(crop.top), bottom: pct(crop.bottom), left: pct(crop.left), right: pct(crop.right) },
        multiPage: !!c.multi_page,
        splitPct: Number.isFinite(split) && split >= 10 && split <= 90 ? split : DEFAULT_CONTROLS.splitPct,
    };
}

// The reverse of languageControls: toggle value + Dhundhari checkbox -> the scan_config "language" string.
// Dhundhari wins over the toggle (matching languageControls' forward read), and a mix is written "gu+hi",
// the only order seen in the configs repo today.
export function controlsToLanguage(language, dhundhari) {
    if (dhundhari) return 'dhundhari';
    return { hin: 'hi', guj: 'gu', 'guj+hin': 'gu+hi' }[language] || 'hi';
}

// The reverse of scanConfigToControls: the controls PDF Parser currently shows -> what to write into the PDF's
// own scan_config.json entry (`values`), and which keys to drop if they were set before (`remove_keys`) --
// e.g. llm_model when switching back to Tesseract, split_percentage when turning multi-page off.
// Crop is NOT included here: it's file-level, shown against the real page (with the crop bands) and saved from
// the Verify popup instead, so there's exactly one place that writes it.
export function controlsToScanConfig(ctl) {
    const values = {
        language: controlsToLanguage(ctl.language, ctl.dhundhari),
        ocr_engine: ctl.mode === 'llm' ? 'llm' : 'tesseract',
        multi_page: !!ctl.multiPage,
    };
    const removeKeys = [];
    if (ctl.mode === 'llm') values.llm_model = ctl.modelName; else removeKeys.push('llm_model');
    if (ctl.multiPage) values.split_percentage = ctl.splitPct; else removeKeys.push('split_percentage');
    return { values, removeKeys };
}

// What the "Save to scan_config.json" popup shows: one row per control the file remembers, each with what was
// loaded and what's on screen now, and whether that changed. `loaded` is what loadScanConfigControls last applied;
// `current` is today's live control values (same shape). Crop isn't a row here -- see controlsToScanConfig.
export function describeControlsDiff(loaded, current) {
    const langLabel = (ctl) => ({ hin: 'Hindi', guj: 'Gujarati', 'guj+hin': 'Gujarati + Hindi' }[ctl.language] || ctl.language)
        + (ctl.dhundhari ? ' (Dhundhari)' : '');
    const engineLabel = (ctl) => (ctl.mode === 'llm' ? 'LLM' : 'Tesseract');
    const rows = [
        ['Language', langLabel(loaded), langLabel(current)],
        ['Engine', engineLabel(loaded), engineLabel(current)],
    ];
    if (loaded.mode === 'llm' || current.mode === 'llm') {
        rows.push(['Model', loaded.mode === 'llm' ? loaded.modelName : '—', current.mode === 'llm' ? current.modelName : '—']);
    }
    rows.push(['Multi-page', loaded.multiPage ? `on (${loaded.splitPct}%)` : 'off', current.multiPage ? `on (${current.splitPct}%)` : 'off']);
    return rows.map(([label, before, after]) => ({ label, before, after, changed: before !== after }));
}

// One-line description of what was applied, e.g. "LLM · Hindi · crop T9 B4".
export function describeControls(ctl) {
    const parts = [ctl.mode === 'llm' ? 'LLM' : 'Tesseract'];
    parts.push({ hin: 'Hindi', guj: 'Gujarati', 'guj+hin': 'Gujarati + Hindi' }[ctl.language] + (ctl.dhundhari ? ' (Dhundhari)' : ''));
    const crop = [['T', ctl.crop.top], ['B', ctl.crop.bottom], ['L', ctl.crop.left], ['R', ctl.crop.right]]
        .filter(([, v]) => v > 0).map(([k, v]) => `${k}${v}`);
    if (crop.length) parts.push(`crop ${crop.join(' ')}`);
    if (ctl.multiPage) parts.push(`multi-page ${ctl.splitPct}%`);
    return parts.join(' · ');
}
