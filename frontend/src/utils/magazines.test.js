import { it, expect } from 'vitest';
import { mergeMagazineMetadata, groupMagazineEditions } from './catalogue';
import { buildCitationLabel, buildReferenceLines, buildInlineQuoteLabel, getCitationCategoryMeta } from '../components/chat/answerFormatting';

it('offers configured magazines in their language before indexing without changing other metadata', () => {
    const metadata = { Books: { hindi: { Name: ['Book'] } } };
    const rows = [{ category: 'Magazine', granth: 'Atmadharma', language: 'hi', issue_count: 423 },
        { category: 'Magazine', granth: 'Atmadharma', language: 'gu', issue_count: 459 }];
    const merged = mergeMagazineMetadata(metadata, rows);
    expect(merged.Magazine.hindi.Name).toEqual(['Atmadharma']);
    expect(merged.Magazine.gujarati.Name).toEqual(['Atmadharma']);
    expect(merged.Books).toEqual(metadata.Books);
    expect(groupMagazineEditions(rows)).toEqual([{ key: 'Atmadharma', granth: 'Atmadharma', hi: true, gu: true, issue_count: 882 }]);
});

it('distinguishes magazine issues and years in inline citations and reference lists', () => {
    const citation = { category: 'Magazine', granth: 'Atmadharma', issue_number: '12', magazine_year: '32', date: '1977-06', page: 16 };
    expect(buildCitationLabel(citation)).toContain('Year 32, Issue 12');
    expect(buildReferenceLines(citation).subtitle).toContain('Year 32, Issue 12');
    expect(buildInlineQuoteLabel(citation)).toContain('Year 32, Issue 12');
    expect(getCitationCategoryMeta('Magazine').label).toBe('Magazine');
});
