import { languageControls, scanConfigToControls, controlsToLanguage, controlsToScanConfig, describeControlsDiff, describeControls, DEFAULT_CONTROLS } from './scanConfigPrefill';

describe('languageControls', () => {
    test.each([
        ['hi', 'hin', false], ['hin', 'hin', false], ['Hindi', 'hin', false],
        ['gu', 'guj', false], ['guj', 'guj', false], ['gujarati', 'guj', false],
        ['hi+gu', 'guj+hin', false], ['guj+hin', 'guj+hin', false], ['gu + hi', 'guj+hin', false],
        ['dhundhari', 'hin', true],
        [undefined, 'hin', false], ['', 'hin', false], ['klingon', 'hin', false],
    ])('%s -> %s (dhundhari %s)', (raw, language, dhundhari) => {
        expect(languageControls(raw)).toEqual({ language, dhundhari });
    });
});

describe('scanConfigToControls', () => {
    test('the Lok Vibhag config: LLM, crop 9/4, Hindi', () => {
        const ctl = scanConfigToControls({ crop: { top: 9, bottom: 4 }, ocr_engine: 'llm', language: 'hi', start_page: 12 });
        expect(ctl).toMatchObject({ mode: 'llm', language: 'hin', crop: { top: 9, bottom: 4, left: 0, right: 0 }, multiPage: false });
        expect(describeControls(ctl)).toBe('LLM · Hindi · crop T9 B4');
    });

    test('an empty or missing config gives exactly the control defaults', () => {
        expect(scanConfigToControls({})).toEqual(DEFAULT_CONTROLS);
        expect(scanConfigToControls(null)).toEqual(DEFAULT_CONTROLS);
    });

    test('only a known LLM model is selected; otherwise the default stays', () => {
        expect(scanConfigToControls({ llm_model: 'gemini-2.5-pro' }).modelName).toBe('gemini-2.5-pro');
        expect(scanConfigToControls({ llm_model: 'some-unlisted-model' }).modelName).toBe(DEFAULT_CONTROLS.modelName);
    });

    test('multi-page and split percentage', () => {
        expect(scanConfigToControls({ multi_page: true, split_percentage: 47 })).toMatchObject({ multiPage: true, splitPct: 47 });
        expect(scanConfigToControls({ multi_page: true, split_percentage: 5 }).splitPct).toBe(50); // out of range -> default
    });

    test('crop values are kept as numbers and clamped to the input range', () => {
        expect(scanConfigToControls({ crop: { top: 9.5, bottom: '4', left: 80, right: -3 } }).crop).toEqual({ top: 9.5, bottom: 4, left: 50, right: 0 });
    });

    test('Gujarati + Hindi book with Tesseract', () => {
        const ctl = scanConfigToControls({ language: 'gu+hi', ocr_engine: 'tesseract' });
        expect(ctl).toMatchObject({ mode: 'tesseract', language: 'guj+hin' });
        expect(describeControls(ctl)).toBe('Tesseract · Gujarati + Hindi');
    });
});

describe('controlsToLanguage', () => {
    test.each([
        ['hin', false, 'hi'], ['guj', false, 'gu'], ['guj+hin', false, 'gu+hi'],
        ['hin', true, 'dhundhari'], ['guj', true, 'dhundhari'], ['guj+hin', true, 'dhundhari'],
    ])('%s (dhundhari %s) -> %s', (language, dhundhari, expected) => {
        expect(controlsToLanguage(language, dhundhari)).toBe(expected);
    });

    test('is the exact reverse of languageControls for every value it can produce', () => {
        for (const raw of ['hi', 'gu', 'gu+hi', 'dhundhari']) {
            const { language, dhundhari } = languageControls(raw);
            expect(controlsToLanguage(language, dhundhari)).toBe(raw);
        }
    });
});

describe('controlsToScanConfig', () => {
    const LLM_CTL = {
        mode: 'llm', language: 'hin', dhundhari: false, modelName: 'gemini-2.5-pro',
        crop: { top: 6, bottom: 4, left: 0, right: 0 }, multiPage: false, splitPct: 50,
    };

    test('an LLM, non-multi-page file: llm_model is set, split_percentage is dropped; crop is not included', () => {
        const { values, removeKeys } = controlsToScanConfig(LLM_CTL);
        expect(values).toEqual({ language: 'hi', ocr_engine: 'llm', multi_page: false, llm_model: 'gemini-2.5-pro' });
        expect(values.crop).toBeUndefined();
        expect(removeKeys).toEqual(['split_percentage']);
    });

    test('a Tesseract, multi-page file: split_percentage is set, llm_model is dropped', () => {
        const ctl = { ...LLM_CTL, mode: 'tesseract', multiPage: true, splitPct: 40 };
        const { values, removeKeys } = controlsToScanConfig(ctl);
        expect(values).toMatchObject({ ocr_engine: 'tesseract', multi_page: true, split_percentage: 40 });
        expect(values.llm_model).toBeUndefined();
        expect(removeKeys).toEqual(['llm_model']);
    });

    test('round-trips back to the same controls through scanConfigToControls, apart from crop (never included)', () => {
        const ctl = { ...LLM_CTL, language: 'guj+hin', dhundhari: false, multiPage: true, splitPct: 65 };
        const { values } = controlsToScanConfig(ctl);
        const roundTripped = scanConfigToControls(values);
        expect(roundTripped).toEqual({ ...ctl, crop: DEFAULT_CONTROLS.crop });
    });

    test('dhundhari round-trips too, even though the toggle itself only ever loads back as Hindi', () => {
        const ctl = { ...LLM_CTL, dhundhari: true };
        const { values } = controlsToScanConfig(ctl);
        expect(values.language).toBe('dhundhari');
        expect(scanConfigToControls(values)).toEqual({ ...ctl, crop: DEFAULT_CONTROLS.crop });
    });
});

describe('describeControlsDiff', () => {
    const BASE = { mode: 'llm', language: 'hin', dhundhari: false, modelName: 'gemini-2.5-flash', crop: { top: 9, bottom: 4, left: 0, right: 0 }, multiPage: false, splitPct: 50 };

    test('identical controls: every row unchanged, nothing crossed out', () => {
        const rows = describeControlsDiff(BASE, BASE);
        expect(rows.every((r) => !r.changed)).toBe(true);
    });

    test('there is no Crop row -- that is saved from Verify, not this popup', () => {
        const rows = describeControlsDiff(BASE, { ...BASE, crop: { top: 6, bottom: 4, left: 0, right: 0 } });
        expect(rows.find((r) => r.label === 'Crop')).toBeUndefined();
        expect(rows.every((r) => !r.changed)).toBe(true); // a crop-only difference shows as no change at all here
    });

    test('language and dhundhari changes read in plain language', () => {
        const rows = describeControlsDiff(BASE, { ...BASE, language: 'guj+hin', dhundhari: true });
        const lang = rows.find((r) => r.label === 'Language');
        expect(lang.before).toBe('Hindi');
        expect(lang.after).toBe('Gujarati + Hindi (Dhundhari)');
        expect(lang.changed).toBe(true);
    });

    test('switching Tesseract <-> LLM shows the Engine row change, and Model only when LLM is involved', () => {
        const tesseract = { ...BASE, mode: 'tesseract' };
        const rows1 = describeControlsDiff(BASE, tesseract);
        expect(rows1.find((r) => r.label === 'Engine')).toMatchObject({ before: 'LLM', after: 'Tesseract', changed: true });
        expect(rows1.find((r) => r.label === 'Model')).toMatchObject({ before: 'gemini-2.5-flash', after: '—' });

        const noLlmEitherSide = describeControlsDiff(tesseract, { ...tesseract, crop: { ...tesseract.crop, top: 1 } });
        expect(noLlmEitherSide.find((r) => r.label === 'Model')).toBeUndefined();
    });

    test('multi-page on/off and split percentage', () => {
        const rows = describeControlsDiff(BASE, { ...BASE, multiPage: true, splitPct: 40 });
        expect(rows.find((r) => r.label === 'Multi-page')).toMatchObject({ before: 'off', after: 'on (40%)', changed: true });
    });
});

