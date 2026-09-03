import React from 'react';
import { Link } from 'react-router-dom';
import useCatalogue from '../../hooks/useCatalogue';
import { getGranthStats, getContemporaryLiteratureStats } from '../../utils/searchableContent';
import { CategoryEmojiIcon } from './categoryEmoji';

// category keys match categoryEmoji.js's CATEGORY_EMOJI_SRC, and colorVar
// matches the same category->color mapping used in ChatFilters and the
// reference-card badges, so "Pravachan" means the same color everywhere.
// `anchor` is the matching <section id> on SearchIndex.js -- each tile is a
// real link there, so the strip doubles as a mini table-of-contents from
// anywhere in the app.
const DEFAULT_LABELS = { Pravachan: 'Pravachans', Granth: 'Granths', Curated: 'Contemporary Jain Books' };

const TILES = (pravachanTotal, granthSearchable, literatureSearchable, labels) => [
    { category: 'Pravachan', colorVar: '--color-info', value: pravachanTotal != null ? pravachanTotal.toLocaleString() : undefined, label: labels.Pravachan, anchor: 'pravachan-index' },
    { category: 'Granth', colorVar: '--color-brand', value: granthSearchable.toLocaleString(), label: labels.Granth, anchor: 'granth-index' },
    { category: 'Curated', colorVar: '--color-danger', value: literatureSearchable.toLocaleString(), label: labels.Curated, anchor: 'contemporary-index' },
];

// `labels` optionally overrides one or more of the default per-category tile
// labels (e.g. Home.js uses fuller phrasing) — every other call site renders
// with DEFAULT_LABELS, unaffected.
export default function StatsStrip({ topAccent, spacious = false, labels }) {
    const resolvedLabels = { ...DEFAULT_LABELS, ...labels };
    // useCatalogue() shares its underlying fetch/cache with every other
    // caller (e.g. SearchIndex.js) -- see hooks/useCatalogue.js.
    const { rows, loading } = useCatalogue();
    const pravachanTotal = loading ? null : rows.reduce(
        (sum, r) => sum + (r.count !== 'compiled' ? (parseInt(r.count, 10) || 0) : 0), 0
    );

    const granthStats = getGranthStats();
    const literatureStats = getContemporaryLiteratureStats();
    const tiles = TILES(pravachanTotal, granthStats.searchable, literatureStats.searchable, resolvedLabels);

    return (
        <div className={`card flex flex-col sm:flex-row items-stretch relative overflow-hidden ${spacious ? 'px-3 py-4' : 'px-2 py-2.5'}`}>
            {topAccent && <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: topAccent }} />}
            {tiles.map(({ category, colorVar, value, label, anchor }, i) => (
                <Link
                    key={label}
                    to={`/search-index#${anchor}`}
                    className={`flex-1 flex items-center justify-start sm:justify-center rounded-md hover:bg-bg transition-colors ${spacious ? 'gap-4 px-4 py-3' : 'gap-2.5 px-3 py-1'} ${i > 0 ? 'border-t sm:border-t-0 sm:border-l' : ''}`}
                    style={{ borderColor: 'var(--color-border)' }}
                >
                    <div
                        className={`rounded-md flex items-center justify-center shrink-0 ${spacious ? 'w-11 h-11' : 'w-7 h-7'}`}
                        style={{ backgroundColor: `color-mix(in srgb, var(${colorVar}) 14%, var(--color-surface))` }}
                    >
                        <CategoryEmojiIcon category={category} size={spacious ? 24 : 16} />
                    </div>
                    <div className="leading-tight">
                        {value && <div className={spacious ? 'text-xl font-bold text-ink' : 'text-sm font-bold text-ink'}>{value}</div>}
                        <div className={value ? `${spacious ? 'text-sm' : 'text-xs'} text-ink-muted` : `${spacious ? 'text-sm' : 'text-xs'} font-bold text-ink`}>{label}</div>
                    </div>
                </Link>
            ))}
        </div>
    );
}
