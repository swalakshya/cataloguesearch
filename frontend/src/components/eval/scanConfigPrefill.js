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
