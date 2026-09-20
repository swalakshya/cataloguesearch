import { languageControls, scanConfigToControls, describeControls, DEFAULT_CONTROLS } from './scanConfigPrefill';

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
