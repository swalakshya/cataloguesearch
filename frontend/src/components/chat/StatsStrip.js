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
const TILES = (pravachanTotal, granthSearchable, literatureSearchable) => [
    { category: 'Pravachan', colorVar: '--color-info', value: pravachanTotal != null ? pravachanTotal.toLocaleString() : undefined, label: 'Pravachans', anchor: 'pravachan-index' },
    { category: 'Granth', colorVar: '--color-brand', value: granthSearchable.toLocaleString(), label: 'Granths', anchor: 'granth-index' },
    { category: 'Curated', colorVar: '--color-danger', value: literatureSearchable.toLocaleString(), label: 'Contemporary Jain Books', anchor: 'contemporary-index' },
];

export default function StatsStrip() {
    // useCatalogue() shares its underlying fetch/cache with every other
    // caller (e.g. SearchIndex.js) -- see hooks/useCatalogue.js.
    const { rows, loading } = useCatalogue();
    const pravachanTotal = loading ? null : rows.reduce(
        (sum, r) => sum + (r.count !== 'compiled' ? (parseInt(r.count, 10) || 0) : 0), 0
    );

    const granthStats = getGranthStats();
    const literatureStats = getContemporaryLiteratureStats();
    const tiles = TILES(pravachanTotal, granthStats.searchable, literatureStats.searchable);

    return (
        <div className="card flex items-stretch px-2 py-2.5">
            {tiles.map(({ category, colorVar, value, label, anchor }, i) => (
                <Link
                    key={label}
                    to={`/search-index#${anchor}`}
                    className={`flex-1 flex items-center justify-center gap-2.5 px-3 py-1 rounded-md hover:bg-bg transition-colors ${i > 0 ? 'border-l' : ''}`}
                    style={{ borderColor: 'var(--color-border)' }}
                >
                    <div
                        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `color-mix(in srgb, var(${colorVar}) 14%, var(--color-surface))` }}
                    >
                        <CategoryEmojiIcon category={category} size={16} />
                    </div>
                    <div className="leading-tight">
                        {value && <div className="text-sm font-bold text-ink">{value}</div>}
                        <div className={value ? 'text-xs text-ink-muted' : 'text-xs font-bold text-ink'}>{label}</div>
                    </div>
                </Link>
            ))}
        </div>
    );
}
